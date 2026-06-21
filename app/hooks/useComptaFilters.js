'use client';

import { useCallback, useState } from 'react';
import {
  buildAccountingMonth,
  defaultComptaFilters,
  readStoredComptaFilters,
  splitAccountingMonth,
  writeStoredComptaFilters,
} from '../../lib/compta-filters';

export function useComptaFilters() {
  const [applied, setApplied] = useState(() => readStoredComptaFilters() || defaultComptaFilters());
  const [draftLocation, setDraftLocation] = useState(applied.location);
  const [draftMonth, setDraftMonth] = useState(() => splitAccountingMonth(applied.month).month);
  const [draftYear, setDraftYear] = useState(() => splitAccountingMonth(applied.month).year);
  const [filterError, setFilterError] = useState('');

  const applyFilters = useCallback(() => {
    const month = buildAccountingMonth(draftYear, draftMonth);
    if (!month) {
      setFilterError('Année invalide (4 chiffres) ou mois incorrect.');
      return false;
    }
    const next = { location: draftLocation, month };
    setApplied(next);
    writeStoredComptaFilters(next);
    setFilterError('');
    return true;
  }, [draftLocation, draftMonth, draftYear]);

  const filtersDirty =
    draftLocation !== applied.location ||
    buildAccountingMonth(draftYear, draftMonth) !== applied.month;

  return {
    appliedLocation: applied.location,
    appliedMonth: applied.month,
    draftLocation,
    setDraftLocation,
    draftMonth,
    setDraftMonth,
    draftYear,
    setDraftYear,
    applyFilters,
    filterError,
    filtersDirty,
  };
}
