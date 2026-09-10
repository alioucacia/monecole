import { useCallback, useEffect, useState } from "react";
import type { AxiosResponse } from "axios";

import { fetchUrl } from "../api/services";
import type { Paginated } from "../types";

/**
 * Consomme un endpoint DRF paginé (ou un simple tableau) et expose les contrôles
 * "précédent / suivant" en s'appuyant sur les URLs absolues renvoyées par l'API.
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
    setLoading(true);
    fetchUrl<Paginated<T>>(url)
      .then(({ data }) => applyResponse(data))
      .finally(() => setLoading(false));
  };

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
