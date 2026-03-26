// PDF Export Service — uses @react-pdf/renderer for real vector PDFs
import React from 'react';
import { pdf } from '@react-pdf/renderer';
import type { ResearchReport } from './deepResearchService';
import PdfDocument from '../components/research/PdfDocument';

/**
 * Generate a PDF blob from the report using @react-pdf/renderer.
 * Returns a Blob that can be used for download or preview.
 */
export async function generatePdfBlob(report: ResearchReport): Promise<Blob> {
  const doc = React.createElement(PdfDocument, { report });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob();
  return blob;
}

/**
 * Export the report as a downloadable PDF file.
 */
export async function exportReportToPDF(report: ResearchReport): Promise<void> {
  const blob = await generatePdfBlob(report);

  const filename = report.title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);

  // Trigger download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_AlphaSense_AI.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
