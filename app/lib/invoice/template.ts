// ═══════════════════════════════════════════════════════════════
// lib/invoice/template.ts
// Adds `itsquad` and `keshavi` entries pointing at the new
// standalone builder functions in ./itsquad.ts and ./keshavi.ts.
// Every existing entry (default/agastron/modern/lucidus) and
// resolveTemplate()'s currying behavior is unchanged.
// ═══════════════════════════════════════════════════════════════

import { esc } from './utils';
import {
  buildInvoiceHTML, buildPDF, buildDOCX,
  buildInvoiceHTMLThemed, buildPDFThemed, buildDOCXThemed,
  AGASTRON_THEME, MODERN_THEME,
} from './builder';
import {
  buildInvoiceHTMLLucidus, buildPDFLucidus, buildDOCXLucidus,
} from './lucidus';
import {
  buildInvoiceHTMLItsquad, buildPDFItsquad, buildDOCXItsquad,
} from './itsquad';
import {
  buildInvoiceHTMLKeshavi, buildPDFKeshavi, buildDOCXKeshavi,
} from './keshavi';
import {
  buildInvoiceHTMLViscose, buildPDFViscose, buildDOCXViscose,
} from './viscose';
import { buildInvoiceHTMLPaybuzz, buildPDFPaybuzz, buildDOCXPaybuzz } from './paybuzz';
import { buildInvoiceHTMLMerchant1, buildPDFMerchant1, buildDOCXMerchant1 } from './merchant1';
import { buildInvoiceHTMLMerchant2, buildPDFMerchant2, buildDOCXMerchant2 } from './merchant2';
import { buildInvoiceHTMLMerchant3, buildPDFMerchant3, buildDOCXMerchant3 } from './merchant3';


const TEMPLATE_DEFS: any = {
  default: {
    key: 'default',
    label: 'Default',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTML(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDF(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCX(row, profile, invNum, company),
  },
  agastron: {
    key: 'agastron',
    label: 'Agastron',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLThemed(row, profile, invNum, AGASTRON_THEME, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFThemed(row, profile, invNum, AGASTRON_THEME, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXThemed(row, profile, invNum, AGASTRON_THEME, company),
  },
  modern: {
    key: 'modern',
    label: 'Modern',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLThemed(row, profile, invNum, MODERN_THEME, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFThemed(row, profile, invNum, MODERN_THEME, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXThemed(row, profile, invNum, MODERN_THEME, company),
  },
  lucidus: {
    key: 'lucidus',
    label: 'Lucidus',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLLucidus(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFLucidus(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXLucidus(row, profile, invNum, company),
  },
  itsquad: {
    key: 'itsquad',
    label: 'IT Squad',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLItsquad(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFItsquad(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXItsquad(row, profile, invNum, company),
  },
  keshavi: {
    key: 'keshavi',
    label: 'Keshavi',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLKeshavi(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFKeshavi(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXKeshavi(row, profile, invNum, company),
  },
  viscose: {
    key: 'viscose',
    label: 'Viscose',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLViscose(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFViscose(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXViscose(row, profile, invNum, company),
  },
  paybuzz: {
    key: 'paybuzz',
    label: 'Paybuzz',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLPaybuzz(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFPaybuzz(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXPaybuzz(row, profile, invNum, company),
  },
  merchant1: {
    key: 'merchant1',
    label: 'Merchant 1',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLMerchant1(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFMerchant1(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXMerchant1(row, profile, invNum, company), 
  },
  merchant2: {
    key: 'merchant2',
    label: 'Merchant 2',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLMerchant2(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFMerchant2(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXMerchant2(row, profile, invNum, company), 
  },
  merchant3: {
    key: 'merchant3',
    label: 'Merchant 3',
    buildHTML: (row: any, profile: any, invNum: string, company: any) => buildInvoiceHTMLMerchant3(row, profile, invNum, company),
    buildPDF: (row: any, profile: any, invNum: string, company: any) => buildPDFMerchant3(row, profile, invNum, company),
    buildDOCX: (row: any, profile: any, invNum: string, company: any) => buildDOCXMerchant3(row, profile, invNum, company), 
  },

};
  
export function resolveTemplate(profile: any, company: any) {
  const key = (profile && profile.template) || 'default';
  const base = TEMPLATE_DEFS[key] || TEMPLATE_DEFS.default;
  return {
    key: base.key,
    label: base.label,
    buildHTML: (row: any, p: any, invNum: string) => base.buildHTML(row, p, invNum, company),
    buildPDF: (row: any, p: any, invNum: string) => base.buildPDF(row, p, invNum, company),
    buildDOCX: (row: any, p: any, invNum: string) => base.buildDOCX(row, p, invNum, company),
  };
}

export function templateOptionsHTML(selectedKey?: string) {
  return Object.values(TEMPLATE_DEFS).map((t: any) =>
    `<option value="${t.key}" ${t.key === (selectedKey || 'default') ? 'selected' : ''}>${esc(t.label)}</option>`
  ).join('');
}