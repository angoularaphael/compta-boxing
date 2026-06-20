'use client';

import { useCallback, useEffect, useState } from 'react';
import ActionButton from '../../components/ActionButton';
import { LOCATION_LABELS, LOCATION_SLUGS, currentAccountingMonth } from '../../../lib/locations';
import { parseApiJson } from '../../../lib/apiJson';

export default function MatchPanel() {
  const [location, setLocation] = useState(LOCATION_SLUGS[0]);
  const [month, setMonth] = useState(currentAccountingMonth());
  const [unmatchedTx, setUnmatchedTx] = useState([]);
  const [unmatchedInvoices, setUnmatchedInvoices] = useState([]);
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/match?location=${location}&month=${month}`);
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setUnmatchedTx(data.unmatchedTx || []);
      setUnmatchedInvoices(data.unmatchedInvoices || []);
      setSelectedTx(null);
      setSelectedInv(null);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, [location, month]);

  useEffect(() => { load(); }, [load]);

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
      setMessage(`Relevé importé — ${data.transactions} ligne(s) trouvée(s).`);
      await load();
      await fetch('/api/match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: location, month }),
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
            On compare le relevé bancaire avec les factures reçues — pour voir ce qui manque.
          </p>
        </div>
      </div>

      <div className="card compta-guide">
        <h3 style={{ marginTop: 0 }}>Comment faire ?</h3>
        <ol className="compta-steps compta-steps--big">
          <li><strong>Importer le relevé bancaire</strong> (PDF de la banque) ci-dessous</li>
          <li>L&apos;app montre les <strong>dépenses sans facture</strong> et les <strong>factures sans dépense</strong></li>
          <li>Si tu sais que deux lignes vont ensemble : clique l&apos;une puis l&apos;autre → <strong>C&apos;est la même</strong></li>
        </ol>
      </div>

      <div className="card">
        <div className="form-row" style={{ marginBottom: '0.75rem' }}>
          <div className="form-field">
            <label>Salle</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)} disabled={loading}>
              {LOCATION_SLUGS.map((slug) => (
                <option key={slug} value={slug}>{LOCATION_LABELS[slug]}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Mois</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={loading} />
          </div>
        </div>
        <label className="muted">Étape 1 — Importer le relevé bancaire (PDF)</label>
        <input className="compta-file-input" type="file" accept="application/pdf,.csv" onChange={uploadStatement} disabled={loading} />
      </div>

      {message ? <p className="form-hint">{message}</p> : null}

      <div className="form-row">
        <ActionButton className="btn btn-secondary" onClick={load} loading={loading}>Actualiser</ActionButton>
        <ActionButton className="btn" onClick={linkManual} loading={loading} disabled={!selectedTx || !selectedInv}>
          C&apos;est la même dépense
        </ActionButton>
      </div>

      <div className="match-lists">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dépenses sur le relevé sans facture ({unmatchedTx.length})</h3>
          <p className="muted">Argent sorti du compte — pas encore de facture trouvée.</p>
          <div className="match-list">
            {unmatchedTx.length === 0 && <p className="muted" style={{ padding: '0.75rem' }}>Rien ici — parfait ou pas encore de relevé importé.</p>}
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
