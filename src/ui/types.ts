import type { LampParams } from '../model/params';

/** Apply an in-place mutation to a clone of the current params and commit it as one history step. */
export type Edit = (mutate: (draft: LampParams) => void) => void;

export interface PanelProps {
  p: LampParams;
  edit: Edit;
}
