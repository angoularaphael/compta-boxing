'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
};

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

  function canDownloadInvoice(inv) {
    return inv.ocr_status === 'ok' || inv.ocr_status === 'partial';
  }

  function canDeleteInvoice(inv) {
    return inv.ocr_status !== 'pending';
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

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/invoices?location=${location}&month=${month}`);
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setInvoices(data.invoices || []);
      setInvoiceCount((data.invoices || []).length);
      const stRes = await fetch(`/api/statements?location=${location}&month=${month}`);
      const stData = await parseApiJson(stRes);
      setHasStatement(Boolean(stData.statement));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, [location, month]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const hasPending = invoices.some((inv) => inv.ocr_status === 'pending');
    if (!hasPending) return undefined;
    const timer = setInterval(() => { load(); }, 5000);
    return () => clearInterval(timer);
  }, [invoices, load]);

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
      a.download = `compta-${location}-${month}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Dossier téléchargé — envoyez-le à votre comptable.');
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
          <p className="ik-generator-lead">{invoiceCount} facture(s) ce mois-ci</p>
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
            <strong>Envoyer au comptable</strong> — bouton ci-dessous pour télécharger le dossier ZIP
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
          <p className="muted">Un ZIP avec toutes les factures du mois + le récapitulatif.</p>
          <ActionButton className="btn" onClick={exportMonth} loading={loading}>
            Télécharger le dossier du mois
          </ActionButton>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Factures reçues ce mois</h3>
        {!hasStatement && invoiceCount > 0 ? (
          <p className="form-hint">
            Prochaine étape : allez sur <Link href="/admin/match">Vérifier le mois</Link> pour importer le relevé bancaire.
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reçu le</th>
                <th>Date facture</th>
                <th>Fournisseur</th>
                <th>Montant</th>
                <th>Analyse</th>
                <th>Fichier</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Aucune facture pour l&apos;instant. Le client peut en envoyer sur WhatsApp.
                  </td>
                </tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{formatDateTimeFr(inv.created_at)}</td>
                  <td>{inv.invoice_date || '—'}</td>
                  <td>{inv.vendor_name || '—'}</td>
                  <td>{inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}</td>
                  <td>{OCR_LABELS[inv.ocr_status] || inv.ocr_status || '—'}</td>
                  <td>{inv.file_name}</td>
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
                      {!canDownloadInvoice(inv) && !canDeleteInvoice(inv) ? (
                        <span className="muted">—</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
