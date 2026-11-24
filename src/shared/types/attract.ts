/** Attract screen media (F19): the photos and clips the idle loop cycles through. */
export type AttractMediaKind = 'image' | 'video';

export type AttractMedia = {
  /** The stored file name, and the id used to read or remove the item. */
  id: string;
  kind: AttractMediaKind;
  /** The file's original name, tidied for display. */
  label: string;
  bytes: number;
};
