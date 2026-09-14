import { createContext, useContext } from 'react';
import type { Me } from '../services/types';

export const MeContext = createContext<Me | null>(null);

/** Profile, organization and platform settings for the signed-in user (loaded by AppLayout). */
export function useMe(): Me | null {
  return useContext(MeContext);
}
