'use client';

import { useCallback, useState } from 'react';
import { splitError } from './api';

/**
 * Where a rejected form puts what it was told.
 *
 * Thirty-five pages showed every failure as one banner at the top, and the
 * `Field` primitive's `error` prop — which exists for exactly this — was used
 * by none of them. A reader whose form is rejected was told what was wrong and
 * left to work out which of eleven inputs it referred to.
 *
 * `capture` splits a failure: when the server named the input, that input is
 * marked and the banner stays empty; otherwise the banner carries it. The two
 * are never both set, so a message is never shown twice.
 */
export function useFormErrors() {
  const [fieldError, setFieldError] = useState<{
    field: string;
    message: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const capture = useCallback((error: unknown) => {
    const split = splitError(error);
    setFieldError(split.fieldError);
    setFormError(split.formError);
  }, []);

  const clear = useCallback(() => {
    setFieldError(null);
    setFormError(null);
  }, []);

  /** Hand straight to `<Field error={…}>`. */
  const errorFor = useCallback(
    (field: string) => (fieldError?.field === field ? fieldError.message : null),
    [fieldError],
  );

  /** Marks a field from the page's own checks, before anything is sent. */
  const reject = useCallback((field: string, message: string) => {
    setFieldError({ field, message });
    setFormError(null);
  }, []);

  return { fieldError, formError, capture, clear, errorFor, reject };
}
