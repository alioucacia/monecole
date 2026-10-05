import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosResponse } from "axios";

import { fetchUrl } from "../api/services";
import type { Paginated } from "../types";
import { useAutoRefresh } from "./useAutoRefresh";

/**
 * Consomme un endpoint DRF paginé (ou un simple tableau) et expose les contrôles
 * "précédent / suivant" en s'appuyant sur les URLs absolues renvoyées par l'API.
 *
 * La liste s'actualise d'elle-même toutes les 5 s (voir useAutoRefresh), silencieusement : pas de
 * spinner, et sur la page de résultats affichée (pas de retour à la première page).
 */
export function usePaginated<T>(
  fetcher: () => Promise<AxiosResponse<Paginated<T> | T[]>>,
  deps: unknown[] = []
) {
  const [items, setItems] = useState<T[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // URL de la page de résultats affichée (`null` = première page, via `fetcher`).
  const pageUrl = useRef<string | null>(null);
  const enCours = useRef(false);
  // Incrémenté à chaque changement de filtres/page : une actualisation silencieuse partie avant
  // n'écrase pas le résultat plus récent.
  const generation = useRef(0);

  const applyResponse = (data: Paginated<T> | T[]) => {
    if (Array.isArray(data)) {
      setItems(data);
      setCount(data.length);
      setNext(null);
      setPrevious(null);
    } else {
      setItems(data.results);
      setCount(data.count);
      setNext(data.next);
      setPrevious(data.previous);
    }
  };

  const reload = useCallback(() => {
    pageUrl.current = null;
    generation.current += 1;
    setLoading(true);
    fetcher()
      .then(({ data }) => applyResponse(data))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  const goTo = (url: string | null) => {
    if (!url) return;
    pageUrl.current = url;
    generation.current += 1;
    setLoading(true);
    fetchUrl<Paginated<T>>(url)
      .then(({ data }) => applyResponse(data))
      .finally(() => setLoading(false));
  };

  // Actualisation silencieuse de la page affichée (une requête à la fois).
  useAutoRefresh(() => {
    if (enCours.current) return;
    enCours.current = true;
    const depart = generation.current;
    const requete = pageUrl.current ? fetchUrl<Paginated<T>>(pageUrl.current) : fetcher();
    requete
      .then(({ data }) => {
        if (generation.current === depart) applyResponse(data);
      })
      .catch(() => {})
      .finally(() => { enCours.current = false; });
  });

  return {
    items,
    count,
    loading,
    hasNext: !!next,
    hasPrevious: !!previous,
    goNext: () => goTo(next),
    goPrevious: () => goTo(previous),
    reload,
  };
}
