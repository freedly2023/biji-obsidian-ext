// Type declarations for third-party libraries loaded via <script> tags

// JSZip
declare class JSZip {
  folder(name: string): JSZipFolder;
  generateAsync(options: { type: string; compression?: string }): Promise<Blob>;
}

interface JSZipFolder {
  file(name: string, data: string | Blob | ArrayBuffer): void;
}

declare var JSZip: {
  new (): JSZip;
};

// FileSaver.js
declare function saveAs(blob: Blob, filename: string): void;

// html2pdf.js
declare function html2pdf(): Html2PdfInstance;

interface Html2PdfInstance {
  set(options: Record<string, any>): Html2PdfInstance;
  from(element: HTMLElement | string): Html2PdfInstance;
  outputPdf(type: string): Promise<Blob>;
}

// docx.js
declare namespace docx {
  class Document {
    constructor(options: { sections: Array<{ properties: Record<string, any>; children: any[] }> });
  }

  class Paragraph {
    constructor(options: {
      children: any[];
      spacing?: { before?: number; after?: number };
    });
  }

  class TextRun {
    constructor(options: {
      text?: string;
      size?: number;
      font?: string;
      bold?: boolean;
      italics?: boolean;
      color?: string;
      style?: string;
      break?: number;
    });
  }

  class ExternalHyperlink {
    constructor(options: {
      children: any[];
      link: string;
    });
  }

  namespace Packer {
    function toBlob(doc: Document): Promise<Blob>;
  }
}

// VaultWriter (loaded before popup.js / notes.js / options.js via concatFiles)
declare var VaultWriter: {
  writeAllNotes(
    notes: any[],
    subfolder: string,
    converter: { filename: (note: any) => string; convert: (note: any) => string },
    onProgress?: (done: number, total: number, written?: number, errors?: number) => void,
    concurrency?: number,
  ): Promise<{ written: number; errors: any[] }>;
};

// Chrome extension types supplement
declare namespace chrome {
  namespace storage {
    namespace local {
      function get(keys: string | string[], callback: (data: Record<string, any>) => void): void;
      function set(items: Record<string, any>, callback?: () => void): void;
      function remove(keys: string | string[], callback?: () => void): void;
    }
  }
  namespace runtime {
    function sendMessage(message: any, callback?: (response: any) => void): void;
    function getURL(path: string): string;
    function openOptionsPage(): void;
    var lastError: { message?: string } | undefined;
    var id: string | undefined;
    var onMessage: {
      addListener(
        callback: (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void
      ): void;
    };
  }
  namespace tabs {
    function query(queryInfo: Record<string, any>, callback: (tabs: any[]) => void): void;
    function sendMessage(tabId: number, message: any, callback?: (response: any) => void): void;
    function create(createProperties: { url?: string; active?: boolean }): void;
  }
}
