/** A problem the caller can fix. The tool layer shows it as one line plus the hint. */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
  }
}
