declare module '@retorquere/bibtex-parser' {
  export function parse(input: string): {
    errors: unknown[];
    entries: unknown[];
  };
}

declare module '@citation-js/core' {
  export class Cite {
    constructor(input: string);
    data: unknown[];
  }
}
