// ═══════════════════════════════════════════════════════════════
// lib/invoice/template.ts
// Updated INVOICE TEMPLATE REGISTRY — adds a `lucidus` entry that
// points at the standalone builder functions in ./lucidus.ts. Every
// existing entry (default/agastron/modern) and resolveTemplate()'s
// currying behavior is unchanged.
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