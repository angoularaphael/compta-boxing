'use client';

import { useCallback, useEffect, useState } from 'react';
import { LOCATION_LABELS, LOCATION_SLUGS, currentAccountingMonth } from '../../lib/locations';
import { parseApiJson } from '../../lib/apiJson';

function ocrBadge(status) {
  if (status === 'ok') return <span className="badge badge-ok">OCR OK</span>;
  if (status === 'partial') return <span className="badge badge-warn">OCR partiel</span>;
  if (status === 'failed') return <span className="badge badge-err">OCR échoué</span>;
  return <span className="badge">En attente</span>;
}

export default function ComptaDashboard() {
  const [location, setLocation] = useState(LOCATION_SLUGS[0]);
  const [month, setMonth] = useState(currentAccountingMonth());
  const [invoices, setInvoices] = useState([]);
  const [statementInfo, setStatementInfo] = useState({ statement: null, transactions: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [invRes, stRes] = await Promise.all([
        fetch(`/api/invoices?location=${location}&month=${month}`),
        fetch(`/api/statements?location=${location}&month=${month}`),
      ]);
      const invData = await parseApiJson(invRes);
      const stData = await parseApiJson(stRes);
      if (!invRes.ok) throw new Error(invData.error);
      if (!stRes.ok) throw new Error(stData.error);
      setInvoices(invData.invoices || []);
      setStatementInfo({ statement: stData.statement, transactions: stData.transactions || [] });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, [location, month]);

  useEffect(() => {
    load();
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
      setMessage('Facture importée.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
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
      setMessage(`Relevé importé — ${data.transactions} dépense(s) détectée(s).`);
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
    try {
      const res = await fetch('/api/match', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationSlug: location, month }),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setMessage(`${data.applied} rapprochement(s) automatique(s).`);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
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
      setMessage('Export téléchargé.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  const matchedCount = statementInfo.transactions.filter((t) => t.matched_invoice_id).length;

  return (
    <div>
      <div className="topbar">
        <h2>Tableau de bord</h2>
        <button className="btn" type="button" onClick={exportMonth} disabled={loading}>
          Exporter le mois
        </button>
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
          <label>Mois comptable</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button className="btn btn-secondary" type="button" onClick={load} disabled={loading}>
          Actualiser
        </button>
        <button className="btn btn-secondary" type="button" onClick={runAutoMatch} disabled={loading}>
          Auto-rapprocher
        </button>
      </div>

      {message && <p className="muted">{message}</p>}

      <div className="stats">
        <div className="stat">
          <span className="muted">Factures</span>
          <strong>{invoices.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">Dépenses relevé</span>
          <strong>{statementInfo.transactions.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">Rapprochées</span>
          <strong>{matchedCount}</strong>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Importer une facture</h3>
          <p className="muted">Ou envoyez-la sur le WhatsApp de la salle.</p>
          <input type="file" accept="image/*,application/pdf" onChange={uploadInvoice} disabled={loading} />
        </div>
        <div className="card">
          <h3>Importer le relevé bancaire</h3>
          <p className="muted">
            {statementInfo.statement
              ? `Relevé : ${statementInfo.statement.file_name}`
              : 'Aucun relevé pour ce mois.'}
          </p>
          <input type="file" accept="application/pdf,.csv" onChange={uploadStatement} disabled={loading} />
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Factures du mois</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Fournisseur</th>
              <th>Montant</th>
              <th>Fichier</th>
              <th>OCR</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucune facture pour ce mois.
                </td>
              </tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.invoice_date || '—'}</td>
                <td>{inv.vendor_name || '—'}</td>
                <td>{inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}</td>
                <td>{inv.file_name}</td>
                <td>{ocrBadge(inv.ocr_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
