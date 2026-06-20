'use client';

import { useCallback, useEffect, useState } from 'react';
import { LOCATION_LABELS, LOCATION_SLUGS, currentAccountingMonth } from '../../../lib/locations';
import { parseApiJson } from '../../../lib/apiJson';

export default function MatchPanel() {
  const [location, setLocation] = useState(LOCATION_SLUGS[0]);
  const [month, setMonth] = useState(currentAccountingMonth());
  const [unmatchedTx, setUnmatchedTx] = useState([]);
  const [unmatchedInvoices, setUnmatchedInvoices] = useState([]);
  const [selectedTx, setSelectedTx] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);
  const [bankLabel, setBankLabel] = useState('');
  const [vendorName, setVendorName] = useState('');
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

  useEffect(() => {
    load();
  }, [load]);

  async function linkManual() {
    if (!selectedTx || !selectedInv) {
      setMessage('Sélectionnez une dépense et une facture.');
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
      setMessage('Liaison enregistrée — les deux éléments disparaissent de la liste.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveAlias() {
    if (!bankLabel || !vendorName) return;
    setLoading(true);
    try {
      const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankLabel, vendorName }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage('Alias enregistré pour les prochains auto-match.');
      setBankLabel('');
      setVendorName('');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h2>Rapprochement manuel</h2>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Salle</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {LOCATION_SLUGS.map((slug) => (
              <option key={slug} value={slug}>
                {LOCATION_LABELS[slug]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>Mois</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button className="btn btn-secondary" type="button" onClick={load} disabled={loading}>
          Actualiser
        </button>
        <button className="btn" type="button" onClick={linkManual} disabled={loading || !selectedTx || !selectedInv}>
          Associer la sélection
        </button>
      </div>

      {message && <p className="muted">{message}</p>}

      <div className="grid-2">
        <div className="card">
          <h3>Dépenses sans facture ({unmatchedTx.length})</h3>
          <div className="match-list">
            {unmatchedTx.length === 0 && <p className="muted">Rien à traiter.</p>}
            {unmatchedTx.map((tx) => (
              <div
                key={tx.id}
                className={`match-item ${selectedTx === tx.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedTx(tx.id);
                  setBankLabel(tx.label);
                }}
              >
                <strong>{Number(tx.amount).toFixed(2)} €</strong> — {tx.tx_date}
                <br />
                <span className="muted">{tx.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Factures sans dépense ({unmatchedInvoices.length})</h3>
          <div className="match-list">
            {unmatchedInvoices.length === 0 && <p className="muted">Rien à traiter.</p>}
            {unmatchedInvoices.map((inv) => (
              <div
                key={inv.id}
                className={`match-item ${selectedInv === inv.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedInv(inv.id);
                  setVendorName(inv.vendor_name || '');
                }}
              >
                <strong>{inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}</strong> —{' '}
                {inv.invoice_date || '—'}
                <br />
                <span className="muted">{inv.vendor_name || inv.file_name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Alias fournisseur (optionnel)</h3>
        <p className="muted">Ex. libellé relevé « des sites plus » → fournisseur « Odécom »</p>
        <div className="form-row">
          <div className="form-field">
            <label>Libellé banque</label>
            <input value={bankLabel} onChange={(e) => setBankLabel(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Nom fournisseur facture</label>
            <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <button className="btn btn-secondary" type="button" onClick={saveAlias} disabled={loading}>
            Enregistrer alias
          </button>
        </div>
      </div>
    </div>
  );
}
