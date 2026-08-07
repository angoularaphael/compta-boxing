'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import ActionButton from '../components/ActionButton';
import ComptaFiltersCard from '../components/ComptaFiltersCard';
import { useComptaFilters } from '../hooks/useComptaFilters';
import { LOCATION_LABELS } from '../../lib/locations';
import { monthLabel } from '../../lib/compta-filters';
import { parseApiJson } from '../../lib/apiJson';
import { formatDateTimeFr } from '../../lib/datetime-fr';

const OCR_LABELS = {
  pending: 'Analyse…',
  ok: 'OK',
  partial: 'Partiel',
  failed: 'Échec',
  duplicate: 'Doublon',
};

function SortHeader({ label, active, dir, onClick }) {
  return (
    <th>
      <button
        type="button"
        onClick={onClick}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          fontWeight: 700,
          color: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
        title="Trier"
      >
        {label}
        <span style={{ opacity: active ? 1 : 0.35, fontSize: '0.75rem' }} aria-hidden>
          {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

function compareInvoices(a, b, sortBy, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1;
  let av;
  let bv;
  if (sortBy === 'created_at') {
    av = a.created_at ? new Date(a.created_at).getTime() : 0;
    bv = b.created_at ? new Date(b.created_at).getTime() : 0;
  } else {
    av = a.invoice_date ? new Date(a.invoice_date).getTime() : 0;
    bv = b.invoice_date ? new Date(b.invoice_date).getTime() : 0;
  }
  if (av !== bv) return (av - bv) * mul;
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return (ca - cb) * mul;
}

export default function ComptaDashboard() {
  const {
    appliedLocation: location,
    appliedMonth: month,
    draftLocation,
    setDraftLocation,
    draftMonth,
    setDraftMonth,
    draftYear,
    setDraftYear,
    applyFilters,
    filterError,
    filtersDirty,
  } = useComptaFilters();
  const [invoices, setInvoices] = useState([]);
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [hasStatement, setHasStatement] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);
  const [message, setMessage] = useState('');
  const [sortBy, setSortBy] = useState('invoice_date');
  const [sortDir, setSortDir] = useState('asc');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    invoice_date: '',
    amount_ttc: '',
    vendor_name: '',
    invoice_number: '',
  });

  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => compareInvoices(a, b, sortBy, sortDir)),
    [invoices, sortBy, sortDir]
  );

  function toggleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'created_at' ? 'desc' : 'asc');
    }
  }

  function displayVendor(name) {
    const s = String(name || '').trim();
    if (!s) return null;
    const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters < 3 || letters / s.length < 0.45) return null;
    return s;
  }

  function missingFields(inv) {
    const missing = [];
    if (!inv.invoice_date) missing.push('date');
    if (inv.amount_ttc == null) missing.push('montant');
    if (!displayVendor(inv.vendor_name)) missing.push('fournisseur');
    return missing;
  }

  function rowClassName(inv) {
    if (inv.ocr_status === 'duplicate') return 'row-duplicate';
    if (inv.ocr_status === 'partial' || inv.ocr_status === 'failed') return 'row-partial';
    return undefined;
  }

  function startEdit(inv) {
    setEditingId(inv.id);
    setEditForm({
      invoice_date: inv.invoice_date || '',
      amount_ttc: inv.amount_ttc != null ? String(inv.amount_ttc) : '',
      vendor_name: displayVendor(inv.vendor_name) || '',
      invoice_number: inv.invoice_number || '',
    });
  }

  async function saveEdit(inv) {
    setRowBusyId(inv.id);
    setMessage('');
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_date: editForm.invoice_date || null,
          amount_ttc: editForm.amount_ttc === '' ? null : editForm.amount_ttc,
          vendor_name: editForm.vendor_name,
          invoice_number: editForm.invoice_number,
        }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      setMessage(
        data.invoice?.ocr_status === 'ok'
          ? 'Facture complétée — analyse OK.'
          : 'Modifications enregistrées.'
      );
      setEditingId(null);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  function canDownloadInvoice(inv) {
    return inv.ocr_status === 'ok' || inv.ocr_status === 'partial';
  }

  function canDeleteInvoice() {
    return true;
  }

  function canReanalyzeInvoice(inv) {
    return inv.ocr_status === 'failed' || inv.ocr_status === 'partial' || inv.ocr_status === 'pending';
  }

  function canEditInvoice(inv) {
    return inv.ocr_status === 'partial' || inv.ocr_status === 'failed' || inv.ocr_status === 'ok';
  }

  async function downloadInvoice(inv) {
    setRowBusyId(inv.id);
    setMessage('');
    try {
      const res = await fetch(`/api/invoices/${inv.id}?signed=1`, { cache: 'no-store' });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Téléchargement impossible');
      if (!data.url) throw new Error('Lien de téléchargement indisponible');

      const a = document.createElement('a');
      a.href = data.url;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  async function reanalyzeInvoice(inv) {
    setRowBusyId(inv.id);
    setMessage('');
    try {
      const res = await fetch(`/api/invoices/${inv.id}/reanalyze`, { method: 'POST' });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage(
        data.invoice?.ocr_status === 'duplicate'
          ? 'Doublon détecté — même numéro de facture.'
          : 'Analyse relancée.'
      );
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteInvoice(inv) {
    if (!window.confirm(`Supprimer « ${inv.file_name} » ?`)) return;
    setRowBusyId(inv.id);
    setMessage('');
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, { method: 'DELETE' });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage('Facture supprimée.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setMessage('');
    }
    try {
      const res = await fetch(`/api/invoices?location=${location}&month=${month}`, {
        cache: 'no-store',
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setInvoices(data.invoices || []);
      setInvoiceCount((data.invoices || []).length);
      if (!silent) {
        const stRes = await fetch(`/api/statements?location=${location}&month=${month}`);
        const stData = await parseApiJson(stRes);
        setHasStatement(Boolean(stData.statement));
      }
    } catch (err) {
      if (!silent) setMessage(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [location, month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      load({ silent: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function uploadInvoice(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('location_slug', location);
    fd.append('file', file);
    setLoading(true);
    try {
      const res = await fetch('/api/invoices', { method: 'POST', body: fd });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage('Facture ajoutée.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  async function exportMonth() {
    setLoading(true);
    try {
      const res = await fetch(`/api/export?location=${location}&month=${month}`);
      if (!res.ok) {
        const data = await parseApiJson(res);
        throw new Error(data.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compta-${location}-${month}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('PDF téléchargé — envoyez-le à votre comptable.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="compta-panel ik-generator">
      <div className="ik-generator-hero">
        <div>
          <p className="ik-generator-eyebrow">Compta Boxing</p>
          <h1>{LOCATION_LABELS[location]} — {monthLabel(month)}</h1>
          <p className="ik-generator-lead">
            {invoiceCount} facture(s) ce mois-ci
            {invoices.some((i) => i.ocr_status === 'duplicate')
              ? ` — ${invoices.filter((i) => i.ocr_status === 'duplicate').length} doublon(s)`
              : ''}
          </p>
        </div>
      </div>

      <div className="card compta-guide">
        <h3 style={{ marginTop: 0 }}>En 3 étapes, chaque mois</h3>
        <ol className="compta-steps compta-steps--big">
          <li>
            <strong>Envoyer les factures</strong> — le client envoie une photo sur WhatsApp (voir{' '}
            <Link href="/admin/whatsapp">Connexion WhatsApp</Link>)
          </li>
          <li>
            <strong>Vérifier le mois</strong> — importer le relevé bancaire et voir ce qui manque (
            <Link href="/admin/match">page Vérifier le mois</Link>)
          </li>
          <li>
            <strong>Envoyer au comptable</strong> — bouton ci-dessous pour télécharger le PDF du mois
          </li>
        </ol>
      </div>

      <ComptaFiltersCard
        draftLocation={draftLocation}
        setDraftLocation={setDraftLocation}
        draftMonth={draftMonth}
        setDraftMonth={setDraftMonth}
        draftYear={draftYear}
        setDraftYear={setDraftYear}
        onApply={applyFilters}
        loading={loading}
        filterError={filterError}
        filtersDirty={filtersDirty}
        appliedLabel={`${LOCATION_LABELS[location]} — ${monthLabel(month)}`}
      />

      {message ? <p className="form-hint">{message}</p> : null}

      <div className="compta-upload-grid">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ajouter une facture (ordinateur)</h3>
          <p className="muted">Normalement le client envoie une photo sur WhatsApp. Ici c&apos;est pour ajouter à la main.</p>
          <input className="compta-file-input" type="file" accept="image/*,application/pdf" onChange={uploadInvoice} disabled={loading} />
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Télécharger pour le comptable</h3>
          <p className="muted">
            Un seul PDF : toutes les factures fusionnées comme un merge iLovePDF, classées de la plus ancienne à la plus récente.
          </p>
          <ActionButton className="btn" onClick={exportMonth} loading={loading}>
            Télécharger le PDF du mois
          </ActionButton>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Factures reçues ce mois</h3>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', margin: 0 }}>
            <span className="muted">Trier par</span>
            <select
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':');
                setSortBy(field);
                setSortDir(dir);
              }}
              style={{ margin: 0, width: 'auto', minWidth: 220 }}
            >
              <option value="invoice_date:asc">Date facture · ancienne → récente</option>
              <option value="invoice_date:desc">Date facture · récente → ancienne</option>
              <option value="created_at:desc">Reçu le · récent → ancien</option>
              <option value="created_at:asc">Reçu le · ancien → récent</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          Mise à jour automatique toutes les 5 secondes (WhatsApp inclus). Cliquez sur les colonnes de date pour trier.
        </p>
        {!hasStatement && invoiceCount > 0 ? (
          <p className="form-hint">
            Prochaine étape : allez sur <Link href="/admin/match">Vérifier le mois</Link> pour importer le relevé bancaire.
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeader
                  label="Reçu le"
                  active={sortBy === 'created_at'}
                  dir={sortDir}
                  onClick={() => toggleSort('created_at')}
                />
                <th>N° facture</th>
                <SortHeader
                  label="Date facture"
                  active={sortBy === 'invoice_date'}
                  dir={sortDir}
                  onClick={() => toggleSort('invoice_date')}
                />
                <th>Fournisseur</th>
                <th>Montant</th>
                <th>Analyse</th>
                <th>Fichier</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Aucune facture pour l&apos;instant. Le client peut en envoyer sur WhatsApp.
                  </td>
                </tr>
              )}
              {sortedInvoices.map((inv) => {
                const missing = missingFields(inv);
                const vendor = displayVendor(inv.vendor_name);
                const isEditing = editingId === inv.id;
                let fileLabel = String(inv.file_name || '');
                try {
                  fileLabel = decodeURIComponent(fileLabel.replace(/\+/g, ' '));
                } catch {
                  /* keep raw */
                }
                return (
                  <Fragment key={inv.id}>
                    <tr className={rowClassName(inv)}>
                      <td>{formatDateTimeFr(inv.created_at)}</td>
                      <td>{inv.invoice_number || '—'}</td>
                      <td>
                        {inv.invoice_date || (
                          <span className="field-missing">Manquante</span>
                        )}
                      </td>
                      <td>
                        {vendor || (
                          <span className="field-missing">
                            {inv.ocr_status === 'partial' || inv.ocr_status === 'failed'
                              ? 'Non détecté'
                              : '—'}
                          </span>
                        )}
                      </td>
                      <td>
                        {inv.amount_ttc != null ? (
                          `${Number(inv.amount_ttc).toFixed(2)} €`
                        ) : (
                          <span className="field-missing">Manquant</span>
                        )}
                      </td>
                      <td>
                        <span className={`ocr-badge ocr-badge--${inv.ocr_status || 'unknown'}`}>
                          {OCR_LABELS[inv.ocr_status] || inv.ocr_status || '—'}
                        </span>
                        {inv.ocr_status === 'duplicate' ? (
                          <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                            Même numéro qu&apos;une facture déjà reçue
                          </span>
                        ) : null}
                        {inv.ocr_status === 'partial' && missing.length > 0 ? (
                          <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: 2 }}>
                            À compléter : {missing.join(', ')}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }} title={fileLabel}>
                        {fileLabel}
                      </td>
                      <td>
                        <div className="table-row-actions">
                          {canDownloadInvoice(inv) ? (
                            <ActionButton
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => downloadInvoice(inv)}
                              loading={rowBusyId === inv.id}
                            >
                              Télécharger
                            </ActionButton>
                          ) : null}
                          {canEditInvoice(inv) ? (
                            <ActionButton
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => (isEditing ? setEditingId(null) : startEdit(inv))}
                            >
                              {isEditing ? 'Fermer' : 'Compléter'}
                            </ActionButton>
                          ) : null}
                          {canReanalyzeInvoice(inv) ? (
                            <ActionButton
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => reanalyzeInvoice(inv)}
                              loading={rowBusyId === inv.id}
                            >
                              Réanalyser
                            </ActionButton>
                          ) : null}
                          {canDeleteInvoice(inv) ? (
                            <ActionButton
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => deleteInvoice(inv)}
                              loading={rowBusyId === inv.id}
                            >
                              Supprimer
                            </ActionButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {isEditing ? (
                      <tr className="row-edit">
                        <td colSpan={8}>
                          <div className="invoice-edit-panel">
                            <p className="muted" style={{ margin: '0 0 0.65rem', fontSize: '0.85rem' }}>
                              Complétez les champs manquants. Date + montant → statut OK.
                            </p>
                            <div className="invoice-edit-grid">
                              <label>
                                Date facture
                                <input
                                  type="date"
                                  value={editForm.invoice_date}
                                  onChange={(e) =>
                                    setEditForm((f) => ({ ...f, invoice_date: e.target.value }))
                                  }
                                />
                              </label>
                              <label>
                                Montant TTC (€)
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editForm.amount_ttc}
                                  onChange={(e) =>
                                    setEditForm((f) => ({ ...f, amount_ttc: e.target.value }))
                                  }
                                  placeholder="0.00"
                                />
                              </label>
                              <label>
                                Fournisseur
                                <input
                                  value={editForm.vendor_name}
                                  onChange={(e) =>
                                    setEditForm((f) => ({ ...f, vendor_name: e.target.value }))
                                  }
                                  placeholder="Nom du fournisseur"
                                />
                              </label>
                              <label>
                                N° facture
                                <input
                                  value={editForm.invoice_number}
                                  onChange={(e) =>
                                    setEditForm((f) => ({ ...f, invoice_number: e.target.value }))
                                  }
                                  placeholder="optionnel"
                                />
                              </label>
                            </div>
                            <div className="table-row-actions" style={{ marginTop: '0.75rem' }}>
                              <ActionButton
                                type="button"
                                className="btn btn-sm"
                                onClick={() => saveEdit(inv)}
                                loading={rowBusyId === inv.id}
                              >
                                Enregistrer
                              </ActionButton>
                              <ActionButton
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setEditingId(null)}
                              >
                                Annuler
                              </ActionButton>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
