'use client';

import ActionButton from './ActionButton';
import { LOCATION_LABELS, LOCATION_SLUGS } from '../../lib/locations';
import { MONTH_OPTIONS } from '../../lib/compta-filters';

export default function ComptaFiltersCard({
  draftLocation,
  setDraftLocation,
  draftMonth,
  setDraftMonth,
  draftYear,
  setDraftYear,
  onApply,
  loading = false,
  filterError = '',
  filtersDirty = false,
  appliedLabel = null,
}) {
  return (
    <div className="card compta-filters-card">
      <h3 style={{ marginTop: 0 }}>Choisir la salle et le mois</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Sélectionnez puis cliquez sur <strong>OK</strong>. Votre choix est mémorisé même après actualisation.
      </p>
      {appliedLabel ? (
        <p className="form-hint" style={{ marginTop: 0 }}>
          Affichage actuel : <strong>{appliedLabel}</strong>
        </p>
      ) : null}
      <div className="form-row compta-filters-row">
        <div className="form-field">
          <label htmlFor="compta-filter-location">Quelle salle ?</label>
          <select
            id="compta-filter-location"
            value={draftLocation}
            onChange={(e) => setDraftLocation(e.target.value)}
            disabled={loading}
          >
            {LOCATION_SLUGS.map((slug) => (
              <option key={slug} value={slug}>{LOCATION_LABELS[slug]}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="compta-filter-month">Mois</label>
          <select
            id="compta-filter-month"
            value={draftMonth}
            onChange={(e) => setDraftMonth(e.target.value)}
            disabled={loading}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="form-field compta-filter-year">
          <label htmlFor="compta-filter-year">Année</label>
          <input
            id="compta-filter-year"
            type="number"
            min="2020"
            max="2035"
            step="1"
            value={draftYear}
            onChange={(e) => setDraftYear(e.target.value)}
            disabled={loading}
            placeholder="2026"
          />
        </div>
        <div className="form-field compta-filter-ok">
          <label>&nbsp;</label>
          <ActionButton
            className="btn"
            onClick={onApply}
            loading={loading}
            disabled={loading}
          >
            OK{filtersDirty ? ' *' : ''}
          </ActionButton>
        </div>
      </div>
      {filterError ? <p className="form-hint form-hint--error">{filterError}</p> : null}
    </div>
  );
}
