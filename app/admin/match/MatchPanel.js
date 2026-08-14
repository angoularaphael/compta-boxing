'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ActionButton from '../../components/ActionButton';
import ComptaFiltersCard from '../../components/ComptaFiltersCard';
import { useComptaFilters } from '../../hooks/useComptaFilters';
import { LOCATION_LABELS } from '../../../lib/locations';
import { monthLabel } from '../../../lib/compta-filters';
import { parseApiJson } from '../../../lib/apiJson';
import { formatDateTimeFr } from '../../../lib/datetime-fr';

export default function MatchPanel() {
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
    jumpToMonth,
    filterError,
    filtersDirty,
  } = useComptaFilters();
  const [unmatchedTx, setUnmatchedTx] = useState([]);
  const [unmatchedInvoices, setUnmatchedInvoices] = useState([]);
  const [matchedPairs, setMatchedPairs] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [totals, setTotals] = useState(null);
  const [statement, setStatement] = useState(null);
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);
  const invoiceFileInputRef = useRef(null);
  const uploadTxRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [matchRes, stRes] = await Promise.all([
        fetch(`/api/match?location=${location}&month=${month}`, { cache: 'no-store' }),
        fetch(`/api/statements?location=${location}&month=${month}`, { cache: 'no-store' }),
      ]);
      const data = await parseApiJson(matchRes);
      const stData = await parseApiJson(stRes);
      if (!matchRes.ok) throw new Error(data.error);
      setUnmatchedTx(data.unmatchedTx || []);
      setUnmatchedInvoices(data.unmatchedInvoices || []);
      setMatchedPairs(data.matchedPairs || []);
      setTotals(data.totals || null);
      setStatement(stData.statement || null);
      setAllTransactions(stData.transactions || []);
      if (!silent) {
        setSelectedTx(null);
        setSelectedInv(null);
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

  async function downloadStatement() {
    try {
      const res = await fetch(`/api/statements?location=${location}&month=${month}&signed=1`, {
        cache: 'no-store',
      });
      const data = await parseApiJson(res);
      if (!res.ok || !data.downloadUrl) throw new Error(data.error || 'Téléchargement impossible');
      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function deleteStatement() {
    if (!statement) return;
    if (!window.confirm(`Supprimer le relevé « ${statement.file_name} » ? Les liaisons avec les factures seront effacées.`)) {
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/statements?location=${location}&month=${month}`, { method: 'DELETE' });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage('Relevé supprimé — vous pouvez en importer un nouveau.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startUploadInvoice(tx) {
    uploadTxRef.current = tx;
    invoiceFileInputRef.current?.click();
  }

  async function uploadInvoiceForLine(e) {
    const file = e.target.files?.[0];
    const tx = uploadTxRef.current;
    e.target.value = '';
    uploadTxRef.current = null;
    if (!file || !tx) return;

    setRowBusyId(tx.id);
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('location_slug', location);
      fd.append('accounting_month', month);
      fd.append('transaction_id', tx.id);
      fd.append('file', file);
      const res = await fetch('/api/invoices', { method: 'POST', body: fd });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Upload impossible');
      setMessage(
        data.matched
          ? 'Facture ajoutée et liée à la ligne — elle disparaît des dépenses sans facture.'
          : 'Facture ajoutée. Liez-la ensuite à la ligne.'
      );
      if (selectedTx === tx.id) setSelectedTx(null);
      await load({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteTransaction(tx) {
    if (!window.confirm(`Supprimer cette ligne ?\n${tx.tx_date} — ${Number(tx.amount).toFixed(2)} € — ${tx.label}`)) {
      return;
    }
    setRowBusyId(tx.id);
    setMessage('');
    try {
      const res = await fetch('/api/match', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx.id }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Suppression impossible');
      setMessage('Ligne du relevé supprimée.');
      if (selectedTx === tx.id) setSelectedTx(null);
      await load({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  async function unlinkPair(pair) {
    const tx = pair.transaction;
    const inv = pair.invoice;
    const invLabel = inv
      ? `${inv.vendor_name || inv.file_name || 'facture'} (${inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'})`
      : 'facture';
    if (
      !window.confirm(
        `Délier cette association ?\nRelevé : ${tx.tx_date} — ${Number(tx.amount).toFixed(2)} € — ${tx.label}\n↔ ${invLabel}\n\nLes deux lignes reviendront dans les listes « sans facture / sans relevé ».`
      )
    ) {
      return;
    }
    setRowBusyId(tx.id);
    setMessage('');
    try {
      const res = await fetch('/api/match', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx.id, action: 'unlink' }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error || 'Déliaison impossible');
      setMessage('Liaison annulée — vous pouvez en refaire une autre.');
      await load({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRowBusyId(null);
    }
  }

  function matchTypeLabel(type) {
    if (type === 'manual') return 'manuel';
    if (type === 'auto_vendor_amount' || type === 'auto' || (type && String(type).startsWith('auto'))) {
      return 'auto';
    }
    return type || 'lié';
  }

  async function uploadStatement(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('location_slug', location);
    fd.append('accounting_month', month);
    fd.append('file', file);
    setLoading(true);
    try {
      const res = await fetch('/api/statements', { method: 'POST', body: fd });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);

      if (data.accountingMonth && data.accountingMonth !== month) {
        jumpToMonth(data.accountingMonth);
      }

      const targetMonth = data.accountingMonth || month;
      setMessage(
        data.monthWarning ||
          `Relevé importé — ${data.transactions} ligne(s) de dépense trouvée(s) pour ${monthLabel(targetMonth)}.`
      );

      await fetch('/api/match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: location, month: targetMonth }),
      });
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  async function runAutoMatch() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: location, month }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage(
        data.applied
          ? `${data.applied} rapprochement(s) automatique(s).`
          : 'Aucun nouveau rapprochement automatique.'
      );
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadDossier() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/export?location=${location}&month=${month}&format=zip`);
      if (!res.ok) {
        const data = await parseApiJson(res);
        throw new Error(data.error || 'Téléchargement impossible');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dossier-compta-${location}-${month}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Dossier téléchargé — relevé + factures classées par date.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function linkManual() {
    if (!selectedTx || !selectedInv) {
      setMessage('Cliquez d\'abord sur une ligne du relevé, puis sur une facture.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: selectedTx, invoiceId: selectedInv, matchType: 'manual' }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage('OK — c\'est noté comme la même dépense.');
      await load();
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
          <p className="ik-generator-eyebrow">Fin de mois</p>
          <h1>Vérifier le mois</h1>
          <p className="ik-generator-lead">
            {LOCATION_LABELS[location]} — {monthLabel(month)} — on compare le relevé bancaire avec les factures reçues.
          </p>
        </div>
      </div>

      <div className="card compta-guide">
        <h3 style={{ marginTop: 0 }}>Comment faire ?</h3>
        <ol className="compta-steps compta-steps--big">
          <li>
            <strong>Choisissez le bon mois</strong> dans le filtre ci-dessous (ex. mai si vous importez le relevé de mai)
          </li>
          <li><strong>Importer le relevé bancaire</strong> (PDF de la banque)</li>
          <li>L&apos;app montre les <strong>dépenses sans facture</strong> et les <strong>factures sans dépense</strong></li>
          <li>
            Si tu sais que deux lignes vont ensemble : clique l&apos;une puis l&apos;autre → <strong>C&apos;est la même</strong>
          </li>
          <li>
            Ou <strong>Ajouter</strong> à côté d&apos;une dépense pour uploader la facture : elle est liée et la ligne
            sort de la liste
          </li>
          <li>En bas : les liaisons déjà faites — <strong>Délier</strong> si une erreur a été faite</li>
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

      <div className="card">
        <label className="muted">Étape 1 — Importer le relevé bancaire (PDF)</label>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.35rem 0 0.75rem' }}>
          Toutes les lignes débit sont importées (doublons inclus), jusqu&apos;au solde créditeur.
          Mise à jour auto toutes les 5 s.
        </p>
        <input className="compta-file-input" type="file" accept="application/pdf,.csv" onChange={uploadStatement} disabled={loading} />
      </div>

      {statement ? (
        <div className="card statement-card">
          <h3 style={{ marginTop: 0 }}>Relevé enregistré</h3>
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            <strong>{statement.file_name}</strong>
            <br />
            Importé le {formatDateTimeFr(statement.imported_at)} — {totals?.statementLines || allTransactions.length} ligne(s) de dépense
          </p>
          <div className="table-row-actions">
            <ActionButton type="button" className="btn btn-secondary btn-sm" onClick={downloadStatement} loading={loading}>
              Télécharger le relevé
            </ActionButton>
            <ActionButton type="button" className="btn btn-secondary btn-sm" onClick={runAutoMatch} loading={loading}>
              Relancer le rapprochement auto
            </ActionButton>
            <ActionButton type="button" className="btn btn-secondary btn-sm" onClick={deleteStatement} loading={loading}>
              Supprimer le relevé
            </ActionButton>
          </div>
        </div>
      ) : (
        <p className="form-hint">Aucun relevé pour {monthLabel(month)}. Importez le PDF ci-dessus.</p>
      )}

      {message ? <p className="form-hint">{message}</p> : null}

      {totals?.statementLines > 0 ? (
        <div className="compta-stats">
          <div className="compta-stat">
            <span>Total dépenses (relevé)</span>
            <strong>{totals.totalExpenses.toFixed(2)} €</strong>
            <span className="muted">{totals.statementLines} ligne(s)</span>
          </div>
          <div className="compta-stat">
            <span>Sans facture</span>
            <strong>{totals.unmatchedExpenses.toFixed(2)} €</strong>
            <span className="muted">{unmatchedTx.length} ligne(s)</span>
          </div>
          <div className="compta-stat">
            <span>Déjà reliées</span>
            <strong>{totals.matchedExpenses.toFixed(2)} €</strong>
            <span className="muted">{totals.matchedCount ?? matchedPairs.length} liaison(s)</span>
          </div>
          <div className="compta-stat">
            <span>Factures non reliées</span>
            <strong>{totals.unmatchedInvoices.toFixed(2)} €</strong>
            <span className="muted">{unmatchedInvoices.length} facture(s)</span>
          </div>
        </div>
      ) : null}

      <div className="form-row">
        <ActionButton className="btn btn-secondary" onClick={() => load()} loading={loading}>
          Actualiser
        </ActionButton>
        <ActionButton className="btn" onClick={linkManual} loading={loading} disabled={!selectedTx || !selectedInv}>
          C&apos;est la même dépense
        </ActionButton>
        <ActionButton className="btn btn-secondary" onClick={downloadDossier} loading={loading}>
          Télécharger le dossier complet
        </ActionButton>
      </div>

      <div className="match-lists">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dépenses sur le relevé sans facture ({unmatchedTx.length})</h3>
          <p className="muted">
            Argent sorti du compte — pas encore de facture. Cliquez pour lier, <strong>Ajouter</strong> pour uploader
            la facture (la ligne passe dans « Déjà liées »), ou supprimez.
          </p>
          <input
            ref={invoiceFileInputRef}
            className="compta-file-input"
            type="file"
            accept="image/*,application/pdf"
            onChange={uploadInvoiceForLine}
            disabled={loading}
            style={{ display: 'none' }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <div className="match-list">
            {unmatchedTx.length === 0 && (
              <p className="muted" style={{ padding: '0.75rem' }}>
                {statement ? 'Rien ici — toutes les dépenses ont une facture ou le relevé est vide.' : 'Importez le relevé bancaire.'}
              </p>
            )}
            {unmatchedTx.map((tx) => (
              <div
                key={tx.id}
                className={`match-item ${selectedTx === tx.id ? 'selected' : ''}`}
                onClick={() => setSelectedTx(tx.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div>
                    <strong>{Number(tx.amount).toFixed(2)} €</strong> — {tx.tx_date}
                    <br />
                    <span className="muted">{tx.label}</span>
                  </div>
                  <div className="match-item-actions">
                    <ActionButton
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        startUploadInvoice(tx);
                      }}
                      loading={rowBusyId === tx.id}
                    >
                      Ajouter
                    </ActionButton>
                    <ActionButton
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTransaction(tx);
                      }}
                      loading={rowBusyId === tx.id}
                    >
                      Supprimer
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Factures reçues sans ligne au relevé ({unmatchedInvoices.length})</h3>
          <p className="muted">Facture WhatsApp — pas encore reliée au relevé.</p>
          <div className="match-list">
            {unmatchedInvoices.length === 0 && <p className="muted" style={{ padding: '0.75rem' }}>Rien ici.</p>}
            {unmatchedInvoices.map((inv) => (
              <div
                key={inv.id}
                className={`match-item ${selectedInv === inv.id ? 'selected' : ''}`}
                onClick={() => setSelectedInv(inv.id)}
              >
                <strong>{inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}</strong> — {inv.invoice_date || '—'}
                <br />
                <span className="muted">{inv.vendor_name || inv.file_name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card matched-pairs-card">
        <h3 style={{ marginTop: 0 }}>Déjà liées ({matchedPairs.length})</h3>
        <p className="muted">
          Liaisons relevé ↔ facture. Si une erreur a été faite, cliquez <strong>Délier</strong> puis refaites le bon couple.
        </p>
        <div className="match-list match-list--matched">
          {matchedPairs.length === 0 && (
            <p className="muted" style={{ padding: '0.75rem' }}>
              Aucune liaison pour l&apos;instant.
            </p>
          )}
          {matchedPairs.map((pair) => {
            const tx = pair.transaction;
            const inv = pair.invoice;
            return (
              <div key={tx.id} className="match-item match-item--linked">
                <div className="matched-pair-row">
                  <div className="matched-pair-sides">
                    <div>
                      <span className="matched-pair-tag">Relevé</span>
                      <strong>{Number(tx.amount).toFixed(2)} €</strong> — {tx.tx_date}
                      <br />
                      <span className="muted">{tx.label}</span>
                    </div>
                    <div className="matched-pair-arrow" aria-hidden>
                      ↔
                    </div>
                    <div>
                      <span className="matched-pair-tag">Facture</span>
                      {inv ? (
                        <>
                          <strong>
                            {inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}
                          </strong>{' '}
                          — {inv.invoice_date || '—'}
                          <br />
                          <span className="muted">{inv.vendor_name || inv.file_name}</span>
                        </>
                      ) : (
                        <span className="muted">Facture introuvable (id {tx.matched_invoice_id})</span>
                      )}
                    </div>
                  </div>
                  <div className="matched-pair-actions">
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {matchTypeLabel(pair.matchType)}
                      {pair.confidence != null ? ` · ${Math.round(Number(pair.confidence) * 100)}%` : ''}
                    </span>
                    <ActionButton
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => unlinkPair(pair)}
                      loading={rowBusyId === tx.id}
                    >
                      Délier
                    </ActionButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
