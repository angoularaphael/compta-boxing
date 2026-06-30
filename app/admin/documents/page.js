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

function SectionHeading({ label, color = 'var(--accent)' }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      margin: '1.75rem 0 1rem',
      paddingBottom: '0.55rem',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{
        display: 'inline-block',
        width: 3,
        height: 16,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: '0.78rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#334155',
      }}>
        {label}
      </span>
    </div>
  );
}

function FormField({ label, required, children }) {
  return (
    <div className="form-field">
      <label>
        {label}
        {required && <span style={{ color: 'var(--err)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
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

      setMessage(`${data.document.type === 'devis' ? 'Devis' : 'Facture'} ${data.document.numero} créé(e) avec succès`);
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

  const isDevis = form.type === 'devis';
  const typeAccent = isDevis ? '#2563eb' : '#16a34a';

  return (
    <div className="main" style={{ maxWidth: 880 }}>

      {/* En-tête */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: 'var(--navy)', letterSpacing: '-0.02em' }}>
          Devis &amp; Factures
        </h1>
        <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)', fontSize: '0.88rem' }}>
          Générez des documents PDF professionnels pour vos clients.
        </p>
      </div>

      {/* Tabs */}
      <div className="mode-tabs" style={{ marginBottom: '1.5rem' }}>
        <button
          className={tab === 'nouveau' ? 'active' : ''}
          onClick={() => setTab('nouveau')}
        >
          Nouveau document
        </button>
        <button
          className={tab === 'historique' ? 'active' : ''}
          onClick={() => setTab('historique')}
        >
          Historique
        </button>
      </div>

      {/* Message feedback */}
      {message && (
        <div style={{
          marginBottom: '1.25rem',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          fontSize: '0.88rem',
          fontWeight: 500,
          background: msgType === 'ok' ? 'var(--ok-bg)' : 'var(--err-bg)',
          color: msgType === 'ok' ? 'var(--ok)' : 'var(--err)',
          border: `1px solid ${msgType === 'ok' ? '#86efac' : '#fca5a5'}`,
        }}>
          {message}
        </div>
      )}

      {/* ─── TAB : Nouveau document ─── */}
      {tab === 'nouveau' && (
        <form onSubmit={handleSubmit}>

          {/* Paramètres */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <SectionHeading label="Paramètres du document" color="var(--accent)" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField label="Type de document" required>
                <select
                  value={form.type}
                  onChange={(e) => setField('type', e.target.value)}
                  style={{
                    fontWeight: 600,
                    color: isDevis ? '#1d4ed8' : '#15803d',
                    borderColor: isDevis ? '#93c5fd' : '#86efac',
                    background: isDevis ? '#eff6ff' : '#f0fdf4',
                  }}
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Société émettrice" required>
                <select value={form.societe} onChange={(e) => setField('societe', e.target.value)}>
                  {SOCIETE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
          </div>

          {/* Client */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <SectionHeading label="Informations client" color="#7c3aed" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField label="Nom du client" required>
                <input
                  value={form.client_nom}
                  onChange={(e) => setField('client_nom', e.target.value)}
                  required
                  placeholder="Nom ou raison sociale"
                />
              </FormField>
              <FormField label="Email">
                <input
                  type="email"
                  value={form.client_email}
                  onChange={(e) => setField('client_email', e.target.value)}
                  placeholder="client@email.com"
                />
              </FormField>
              <FormField label="Adresse">
                <input
                  value={form.client_adresse}
                  onChange={(e) => setField('client_adresse', e.target.value)}
                  placeholder="Adresse complète"
                />
              </FormField>
              <FormField label="Téléphone">
                <input
                  value={form.client_telephone}
                  onChange={(e) => setField('client_telephone', e.target.value)}
                  placeholder="06 XX XX XX XX"
                />
              </FormField>
            </div>
          </div>

          {/* Prestation */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
            <SectionHeading label="Prestation &amp; montant" color="#16a34a" />
            <FormField label="Descriptif de la prestation" required>
              <textarea
                value={form.prestation}
                onChange={(e) => setField('prestation', e.target.value)}
                required
                rows={4}
                placeholder="Description détaillée de la prestation…"
                style={{ resize: 'vertical' }}
              />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.25rem' }}>
              <FormField label="Montant TTC (€)" required>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.montant}
                    onChange={(e) => setField('montant', e.target.value)}
                    required
                    placeholder="0.00"
                    style={{ paddingLeft: '2.25rem', fontWeight: 600 }}
                  />
                  <span style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted)',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    pointerEvents: 'none',
                  }}>€</span>
                </div>
              </FormField>
              <FormField label="Date du document">
                <input
                  type="date"
                  value={form.date_document}
                  onChange={(e) => setField('date_document', e.target.value)}
                />
              </FormField>
            </div>
          </div>

          {/* Options */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <SectionHeading label="Options facultatives" color="#b45309" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField label="Référence interne">
                <input
                  value={form.reference}
                  onChange={(e) => setField('reference', e.target.value)}
                  placeholder="REF-001"
                />
              </FormField>
              <FormField label="Conditions de paiement">
                <input
                  value={form.conditions}
                  onChange={(e) => setField('conditions', e.target.value)}
                  placeholder="Paiement à 30 jours"
                />
              </FormField>
            </div>
          </div>

          {/* Soumission */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '1rem',
            padding: '1rem 1.25rem',
            borderRadius: '10px',
            background: `${typeAccent}0c`,
            border: `1px solid ${typeAccent}28`,
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              Le PDF s'ouvre automatiquement à la génération.
            </span>
            <ActionButton
              type="submit"
              className="btn"
              loading={loading}
              style={{ background: typeAccent, padding: '0.7rem 1.6rem', fontSize: '0.92rem' }}
            >
              Générer le {isDevis ? 'devis' : 'la facture'}
            </ActionButton>
          </div>
        </form>
      )}

      {/* ─── TAB : Historique ─── */}
      {tab === 'historique' && (
        <div className="card" style={{ padding: '1.5rem' }}>

          {/* Filtres */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            alignItems: 'center',
          }}>
            <input
              type="search"
              placeholder="Rechercher (client, numéro, prestation)…"
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
              style={{ margin: 0 }}
            />
            <select
              value={histFilter}
              onChange={(e) => setHistFilter(e.target.value)}
              style={{ margin: 0, width: 'auto', minWidth: '170px' }}
            >
              <option value="">Tous les documents</option>
              <option value="devis">Devis uniquement</option>
              <option value="facture">Factures uniquement</option>
            </select>
            <ActionButton className="btn" onClick={loadDocuments} loading={loading}>
              Actualiser
            </ActionButton>
          </div>

          {/* État vide */}
          {documents.length === 0 && !loading && (
            <div style={{
              textAlign: 'center',
              padding: '2.5rem 1rem',
              color: 'var(--muted)',
              border: '1px dashed var(--border)',
              borderRadius: '8px',
            }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#334155' }}>Aucun document trouvé</p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
                Créez votre premier document via l'onglet « Nouveau document ».
              </p>
            </div>
          )}

          {/* Tableau */}
          {documents.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Numéro</th>
                    <th>Type</th>
                    <th>Société</th>
                    <th>Client</th>
                    <th>Prestation</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'center' }}>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <code style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          padding: '0.2rem 0.4rem',
                          background: '#f1f5f9',
                          borderRadius: '4px',
                          color: '#334155',
                        }}>
                          {d.numero}
                        </code>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          background: d.type === 'devis' ? '#dbeafe' : '#dcfce7',
                          color: d.type === 'devis' ? '#1d4ed8' : '#15803d',
                        }}>
                          {d.type === 'devis' ? 'Devis' : 'Facture'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#475569' }}>
                        {SOCIETE_OPTIONS.find((s) => s.value === d.societe)?.label || d.societe}
                      </td>
                      <td style={{ fontWeight: 600 }}>{d.client_nom}</td>
                      <td style={{
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.85rem',
                        color: '#475569',
                      }}>
                        {d.prestation}
                      </td>
                      <td style={{ fontWeight: 700, textAlign: 'right', color: 'var(--navy)' }}>
                        {formatCurrency(d.montant)}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#475569' }}>
                        {formatDate(d.date_document)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <a
                          href={`/api/documents/${d.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm"
                          style={{
                            background: '#f1f5f9',
                            color: '#334155',
                            border: '1px solid var(--border)',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                          }}
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
