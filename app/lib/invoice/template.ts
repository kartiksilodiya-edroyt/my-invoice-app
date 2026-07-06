// ═══════════════════════════════════════════════════════════════
// lib/invoice/templates.ts
// Verbatim extraction of the INVOICE TEMPLATE REGISTRY section.
//
// Design note: resolveTemplate(profile, company) is the ONLY place
// that needs the new `company` argument. It returns an object whose
// buildHTML/buildPDF/buildDOCX keep the ORIGINAL 3-arg signature
// (row, profile, invNum) — company is curried in here — so every
// existing call site of `tpl.buildHTML(row, profile, invNum)` etc.
// throughout invoice-app.ts stays completely unchanged. Only the
// `resolveTemplate(profile)` call sites themselves need `S.company`
// appended as a second argument.
// ═══════════════════════════════════════════════════════════════

import { esc } from './utils';
import {
  buildInvoiceHTML, buildPDF, buildDOCX,
  buildInvoiceHTMLThemed, buildPDFThemed, buildDOCXThemed,
  AGASTRON_THEME, MODERN_THEME,
} from './builder';

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