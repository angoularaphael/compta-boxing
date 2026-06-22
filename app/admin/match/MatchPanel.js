'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [totals, setTotals] = useState(null);
  const [statement, setStatement] = useState(null);
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

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
      setTotals(data.totals || null);
      setStatement(stData.statement || null);
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
          <li>Si tu sais que deux lignes vont ensemble : clique l&apos;une puis l&apos;autre → <strong>C&apos;est la même</strong></li>
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
          Le relevé est enregistré pour le mois affiché dans le filtre ({monthLabel(month)}). Mise à jour auto toutes les 5 s.
        </p>
        <input className="compta-file-input" type="file" accept="application/pdf,.csv" onChange={uploadStatement} disabled={loading} />
      </div>

      {statement ? (
        <div className="card statement-card">
          <h3 style={{ marginTop: 0 }}>Relevé enregistré</h3>
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            <strong>{statement.file_name}</strong>
            <br />
            Importé le {formatDateTimeFr(statement.imported_at)} — {totals?.statementLines || 0} ligne(s) de dépense
          </p>
          <div className="table-row-actions">
            <ActionButton type="button" className="btn btn-secondary btn-sm" onClick={downloadStatement} loading={loading}>
              Télécharger le relevé
            </ActionButton>
            <ActionButton type="button" className="btn btn-secondary btn-sm" onClick={deleteStatement} loading={loading}>
              Supprimer
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
      </div>

      <div className="match-lists">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dépenses sur le relevé sans facture ({unmatchedTx.length})</h3>
          <p className="muted">Argent sorti du compte — pas encore de facture trouvée.</p>
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
                <strong>{Number(tx.amount).toFixed(2)} €</strong> — {tx.tx_date}
                <br />
                <span className="muted">{tx.label}</span>
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
    </div>
  );
}
