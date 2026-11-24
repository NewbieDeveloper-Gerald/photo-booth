/**
 * The helper program the booth shells out to (F26). It is on PATH on machines where gphoto2 is
 * installed; `PHOTOBOOTH_GPHOTO` overrides it for a custom install location.
 */
export const GPHOTO_PROGRAM = process.env.PHOTOBOOTH_GPHOTO?.trim() || 'gphoto2';
