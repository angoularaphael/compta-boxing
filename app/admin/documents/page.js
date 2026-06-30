'use client';

import { useCallback, useEffect, useState } from 'react';
import ActionButton from '../../components/ActionButton';
import { parseApiJson } from '../../../lib/apiJson';

const SOCIETE_OPTIONS = [
  { value: 'asso_tmbc', label: 'ASSO TMBC' },
  { value: 'boxing_center', label: 'BOXING CENTER' },
  { value: 'distrix', label: 'DISTRIX' },
];

const TYPE_OPTIONS = [
  { value: 'devis', label: 'Devis' },
  { value: 'facture', label: 'Facture' },
];

function formatCurrency(amount) {
  if (!amount) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(amount));
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

export default function DocumentsPage() {
  const [tab, setTab] = useState('nouveau');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState('');
  const [histSearch, setHistSearch] = useState('');
  const [histFilter, setHistFilter] = useState('');

  const [form, setForm] = useState({
    type: 'devis',
    societe: 'boxing_center',
    client_nom: '',
    client_email: '',
    client_adresse: '',
    client_telephone: '',
    prestation: '',
    montant: '',
    date_document: new Date().toISOString().slice(0, 10),
    reference: '',
    conditions: '',
  });

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (histFilter) params.set('type', histFilter);
      if (histSearch) params.set('search', histSearch);
      const res = await fetch(`/api/documents?${params}`);
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setDocuments(data.documents || []);
    } catch (err) {
      setMessage(err.message);
      setMsgType('err');
    } finally {
      setLoading(false);
    }
  }, [histFilter, histSearch]);

  useEffect(() => {
    if (tab === 'historique') loadDocuments();
  }, [tab, loadDocuments]);

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);

      setMessage(`${data.document.type === 'devis' ? 'Devis' : 'Facture'} ${data.document.numero} créé(e)`);
      setMsgType('ok');

      window.open(`/api/documents/${data.document.id}/pdf`, '_blank');

      setForm((f) => ({
        ...f,
        client_nom: '',
        client_email: '',
        client_adresse: '',
        client_telephone: '',
        prestation: '',
        montant: '',
        reference: '',
        conditions: '',
      }));
    } catch (err) {
      setMessage(err.message);
      setMsgType('err');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Devis & Factures</h1>
        <p className="page-desc">Générez des devis et factures PDF pour vos clients.</p>
      </div>

      <div className="tab-bar" style={{ marginBottom: 24 }}>
        <button
          className={`tab-btn ${tab === 'nouveau' ? 'active' : ''}`}
          onClick={() => setTab('nouveau')}
        >
          Nouveau document
        </button>
        <button
          className={`tab-btn ${tab === 'historique' ? 'active' : ''}`}
          onClick={() => setTab('historique')}
        >
          Historique
        </button>
      </div>

      {message && (
        <p className={`form-msg ${msgType}`} style={{ marginBottom: 16 }}>
          {message}
        </p>
      )}

      {tab === 'nouveau' && (
        <form onSubmit={handleSubmit} className="card" style={{ padding: 24 }}>
          <div className="form-grid-2">
            <div>
              <label>Type de document *</label>
              <select value={form.type} onChange={(e) => setField('type', e.target.value)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Société émettrice *</label>
              <select value={form.societe} onChange={(e) => setField('societe', e.target.value)}>
                {SOCIETE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <h3 style={{ margin: '24px 0 12px', fontSize: 14, color: 'var(--navy)' }}>
            Informations client
          </h3>
          <div className="form-grid-2">
            <div>
              <label>Nom du client *</label>
              <input
                value={form.client_nom}
                onChange={(e) => setField('client_nom', e.target.value)}
                required
                placeholder="Nom ou raison sociale"
              />
            </div>
            <div>
              <label>Email</label>
              <input
                type="email"
                value={form.client_email}
                onChange={(e) => setField('client_email', e.target.value)}
                placeholder="client@email.com"
              />
            </div>
            <div>
              <label>Adresse</label>
              <input
                value={form.client_adresse}
                onChange={(e) => setField('client_adresse', e.target.value)}
                placeholder="Adresse complète"
              />
            </div>
            <div>
              <label>Téléphone</label>
              <input
                value={form.client_telephone}
                onChange={(e) => setField('client_telephone', e.target.value)}
                placeholder="06 XX XX XX XX"
              />
            </div>
          </div>

          <h3 style={{ margin: '24px 0 12px', fontSize: 14, color: 'var(--navy)' }}>
            Prestation
          </h3>
          <div>
            <label>Descriptif de la prestation *</label>
            <textarea
              value={form.prestation}
              onChange={(e) => setField('prestation', e.target.value)}
              required
              rows={3}
              placeholder="Description détaillée de la prestation..."
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
          <div className="form-grid-2" style={{ marginTop: 12 }}>
            <div>
              <label>Montant TTC (€) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.montant}
                onChange={(e) => setField('montant', e.target.value)}
                required
                placeholder="0.00"
              />
            </div>
            <div>
              <label>Date du document</label>
              <input
                type="date"
                value={form.date_document}
                onChange={(e) => setField('date_document', e.target.value)}
              />
            </div>
            <div>
              <label>Référence</label>
              <input
                value={form.reference}
                onChange={(e) => setField('reference', e.target.value)}
                placeholder="REF-001 (optionnel)"
              />
            </div>
            <div>
              <label>Conditions</label>
              <input
                value={form.conditions}
                onChange={(e) => setField('conditions', e.target.value)}
                placeholder="Paiement à 30 jours (optionnel)"
              />
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <ActionButton type="submit" className="btn btn-primary" loading={loading}>
              Générer le {form.type === 'devis' ? 'devis' : 'la facture'}
            </ActionButton>
          </div>
        </form>
      )}

      {tab === 'historique' && (
        <div className="card" style={{ padding: 24 }}>
          <div className="form-grid-2" style={{ marginBottom: 16 }}>
            <input
              type="search"
              placeholder="Rechercher (client, numéro, prestation)…"
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
            />
            <select value={histFilter} onChange={(e) => setHistFilter(e.target.value)}>
              <option value="">Tous les documents</option>
              <option value="devis">Devis uniquement</option>
              <option value="facture">Factures uniquement</option>
            </select>
          </div>

          <ActionButton className="btn btn-sm" onClick={loadDocuments} loading={loading}>
            Actualiser
          </ActionButton>

          {documents.length === 0 && !loading && (
            <p style={{ color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>
              Aucun document trouvé.
            </p>
          )}

          {documents.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Numéro</th>
                    <th>Type</th>
                    <th>Société</th>
                    <th>Client</th>
                    <th>Prestation</th>
                    <th>Montant</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td><code style={{ fontSize: 12 }}>{d.numero}</code></td>
                      <td>
                        <span className={`badge ${d.type === 'devis' ? 'badge-info' : 'badge-success'}`}>
                          {d.type === 'devis' ? 'Devis' : 'Facture'}
                        </span>
                      </td>
                      <td>{SOCIETE_OPTIONS.find((s) => s.value === d.societe)?.label || d.societe}</td>
                      <td>{d.client_nom}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.prestation}
                      </td>
                      <td style={{ fontWeight: 600 }}>{formatCurrency(d.montant)}</td>
                      <td>{formatDate(d.date_document)}</td>
                      <td>
                        <a
                          href={`/api/documents/${d.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm"
                        >
                          PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
