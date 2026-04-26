// Innovation Data Service — patents · clinical trials · FDA events
//
// Plan §4: "Patents, clinical trials, FDA/EMA/FCC — Build (free APIs)
//          USPTO/Google Patents BQ, ClinicalTrials.gov, openFDA — ~$0"
//
// Three free public-data sources that unlock biotech / pharma / semi /
// hardware thematic research the platform currently can't service. All
// three are JSON, no key required, generous rate limits.

// ─── PatentsView (USPTO) ───────────────────────────────────────────────────
// API docs: https://search.patentsview.org/docs/
// No key required. Search patents by assignee organization, abstract
// keywords, CPC classification, etc. Returns granted patents with
// inventor + assignee + abstract + classification + grant date.

export const PATENTSVIEW_BASE = 'https://search.patentsview.org/api/v1/patent';

export interface PatentRecord {
    patentNumber: string;
    title: string;
    grantDate: string;          // YYYY-MM-DD
    assignees: string[];
    abstract: string;
    cpcSubclasses: string[];    // primary classification codes (e.g. "G06N3/08")
}

export interface PatentSearchOptions {
    query?: string;             // free-text against title + abstract
    assignee?: string;          // assignee organization name
    cpc?: string;               // CPC subclass prefix (e.g. "G06N" for ML)
    grantedAfter?: string;      // YYYY-MM-DD
    limit?: number;             // default 20, max 100
}

export function buildPatentsViewQuery(opts: PatentSearchOptions): string {
    const conditions: any[] = [];
    if (opts.query) {
        conditions.push({
            _or: [
                { _text_phrase: { patent_title: opts.query } },
                { _text_phrase: { patent_abstract: opts.query } },
            ],
        });
    }
    if (opts.assignee) {
        conditions.push({ _text_phrase: { assignees: { assignee_organization: opts.assignee } } });
    }
    if (opts.cpc) {
        conditions.push({ _begins: { 'cpc_current.cpc_subclass_id': opts.cpc } });
    }
    if (opts.grantedAfter) {
        conditions.push({ _gte: { patent_date: opts.grantedAfter } });
    }
    const q = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { _and: conditions };
    return JSON.stringify(q);
}

// PatentsView returns a deeply-nested envelope; flatten to the fields a
// research workflow actually uses.
export function parsePatentsViewResponse(json: unknown): PatentRecord[] {
    if (!json || typeof json !== 'object') return [];
    const rows = (json as any).patents;
    if (!Array.isArray(rows)) return [];
    const out: PatentRecord[] = [];
    for (const r of rows as any[]) {
        if (!r) continue;
        const assignees = Array.isArray(r.assignees)
            ? (r.assignees as any[])
                .map(a => String(a?.assignee_organization ?? '').trim())
                .filter(Boolean)
            : [];
        const cpc = Array.isArray(r.cpc_current)
            ? Array.from(new Set((r.cpc_current as any[])
                .map(c => String(c?.cpc_subclass_id ?? '').trim())
                .filter(Boolean)))
            : [];
        out.push({
            patentNumber: String(r.patent_number ?? r.patent_id ?? ''),
            title: String(r.patent_title ?? '').trim(),
            grantDate: String(r.patent_date ?? '').slice(0, 10),
            assignees,
            abstract: String(r.patent_abstract ?? '').trim(),
            cpcSubclasses: cpc,
        });
    }
    return out;
}

export async function searchPatents(opts: PatentSearchOptions = {}): Promise<PatentRecord[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
    const url = new URL(PATENTSVIEW_BASE);
    url.searchParams.set('q', buildPatentsViewQuery(opts));
    url.searchParams.set('f', JSON.stringify([
        'patent_id', 'patent_number', 'patent_title', 'patent_date',
        'patent_abstract', 'assignees.assignee_organization',
        'cpc_current.cpc_subclass_id',
    ]));
    url.searchParams.set('o', JSON.stringify({ size: limit }));
    url.searchParams.set('s', JSON.stringify([{ patent_date: 'desc' }]));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`PatentsView: HTTP ${res.status}`);
    const json = await res.json();
    return parsePatentsViewResponse(json);
}

// ─── ClinicalTrials.gov v2 ────────────────────────────────────────────────
// Docs: https://clinicaltrials.gov/data-api/api
// No key required. Search trials by condition / sponsor / status / phase.

export const CLINICAL_TRIALS_BASE = 'https://clinicaltrials.gov/api/v2/studies';

export type TrialStatus =
    | 'NOT_YET_RECRUITING' | 'RECRUITING' | 'ENROLLING_BY_INVITATION'
    | 'ACTIVE_NOT_RECRUITING' | 'COMPLETED' | 'TERMINATED' | 'WITHDRAWN'
    | 'SUSPENDED' | 'UNKNOWN';

export interface TrialRecord {
    nctId: string;
    title: string;
    status: TrialStatus | string;
    phase: string;              // e.g. "PHASE3" or "PHASE2/PHASE3"
    sponsor: string;
    condition: string;
    intervention: string;
    startDate: string;          // YYYY-MM-DD or YYYY-MM
    primaryCompletion: string;
    studyType: string;          // INTERVENTIONAL / OBSERVATIONAL
}

export interface TrialSearchOptions {
    condition?: string;         // e.g. "obesity" or "small cell lung cancer"
    sponsor?: string;           // e.g. "Eli Lilly"
    status?: TrialStatus[];     // filter to e.g. ['RECRUITING', 'COMPLETED']
    phase?: string;             // 'PHASE1' / 'PHASE2' / 'PHASE3' / 'PHASE4'
    limit?: number;             // default 20, max 100
}

export function buildClinicalTrialsQuery(opts: TrialSearchOptions): URLSearchParams {
    const params = new URLSearchParams();
    params.set('format', 'json');
    params.set('pageSize', String(Math.max(1, Math.min(opts.limit ?? 20, 100))));
    // ClinicalTrials.gov v2 uses query.cond / query.spons / etc.
    if (opts.condition) params.set('query.cond', opts.condition);
    if (opts.sponsor)   params.set('query.spons', opts.sponsor);
    if (opts.status && opts.status.length > 0) {
        params.set('filter.overallStatus', opts.status.join(','));
    }
    if (opts.phase) params.set('filter.advanced', `AREA[Phase]${opts.phase}`);
    return params;
}

export function parseClinicalTrialsResponse(json: unknown): TrialRecord[] {
    if (!json || typeof json !== 'object') return [];
    const studies = (json as any).studies;
    if (!Array.isArray(studies)) return [];
    const out: TrialRecord[] = [];
    for (const s of studies as any[]) {
        const proto = s?.protocolSection;
        if (!proto) continue;
        const id = String(proto.identificationModule?.nctId ?? '');
        const title = String(proto.identificationModule?.briefTitle ?? '');
        const status = String(proto.statusModule?.overallStatus ?? '');
        const phaseList = proto.designModule?.phases;
        const phase = Array.isArray(phaseList) && phaseList.length > 0
            ? phaseList.map((p: any) => String(p)).join('/')
            : '';
        const sponsor = String(proto.sponsorCollaboratorsModule?.leadSponsor?.name ?? '');
        const conditions = proto.conditionsModule?.conditions;
        const condition = Array.isArray(conditions) ? conditions.join(', ') : '';
        const interventions = proto.armsInterventionsModule?.interventions;
        const intervention = Array.isArray(interventions)
            ? (interventions as any[])
                .map(i => `${String(i?.type ?? '')}: ${String(i?.name ?? '')}`)
                .filter(s => s !== ': ')
                .join(', ')
            : '';
        const startDate = String(proto.statusModule?.startDateStruct?.date ?? '');
        const primary = String(proto.statusModule?.primaryCompletionDateStruct?.date ?? '');
        const studyType = String(proto.designModule?.studyType ?? '');
        if (id) {
            out.push({
                nctId: id, title, status, phase, sponsor,
                condition, intervention, startDate,
                primaryCompletion: primary, studyType,
            });
        }
    }
    return out;
}

export async function searchClinicalTrials(opts: TrialSearchOptions = {}): Promise<TrialRecord[]> {
    const url = `${CLINICAL_TRIALS_BASE}?${buildClinicalTrialsQuery(opts).toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ClinicalTrials.gov: HTTP ${res.status}`);
    const json = await res.json();
    return parseClinicalTrialsResponse(json);
}

// ─── openFDA — drug events + approvals ────────────────────────────────────
// Docs: https://open.fda.gov/apis/
// No key required (1000 req/hr unauthenticated; 240/min with free key).
// Two endpoints worth covering:
//   /drug/event.json   — adverse-event reports (FAERS)
//   /drug/label.json   — approved drug labeling

export const OPENFDA_DRUG_EVENT_BASE = 'https://api.fda.gov/drug/event.json';
export const OPENFDA_DRUG_LABEL_BASE = 'https://api.fda.gov/drug/label.json';

export interface DrugEventCount {
    term: string;       // adverse-event MedDRA term
    count: number;
}

// FAERS adverse-event counts for a given drug name. Returns the top-N
// reaction terms ranked by report count over the available history.
export async function fetchDrugAdverseEvents(drugName: string, limit = 10): Promise<DrugEventCount[]> {
    if (!drugName) return [];
    const url = new URL(OPENFDA_DRUG_EVENT_BASE);
    // Search the drug field; ?count returns aggregate counts over a path
    url.searchParams.set('search', `patient.drug.medicinalproduct:"${drugName}"`);
    url.searchParams.set('count', 'patient.reaction.reactionmeddrapt.exact');
    url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 100))));
    const res = await fetch(url.toString());
    if (!res.ok) {
        // openFDA returns 404 when there are no matching records — treat
        // that as "no adverse events" rather than an error.
        if (res.status === 404) return [];
        throw new Error(`openFDA event: HTTP ${res.status}`);
    }
    const json = await res.json();
    const rows = (json as any)?.results;
    if (!Array.isArray(rows)) return [];
    return (rows as any[])
        .map(r => ({ term: String(r?.term ?? ''), count: Number(r?.count) || 0 }))
        .filter(r => r.term);
}

export interface DrugLabelRecord {
    brandName: string;
    genericName: string;
    manufacturer: string;
    indications: string;        // first 500 chars of indications_and_usage
    warnings: string;            // first 500 chars of warnings or boxed_warning
    approvalDate: string;        // best-effort from openfda.original_packager_product_ndc or empty
}

export async function fetchDrugLabel(drugName: string): Promise<DrugLabelRecord | null> {
    if (!drugName) return null;
    const url = new URL(OPENFDA_DRUG_LABEL_BASE);
    url.searchParams.set('search', `openfda.brand_name:"${drugName}" openfda.generic_name:"${drugName}"`);
    url.searchParams.set('limit', '1');
    const res = await fetch(url.toString());
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`openFDA label: HTTP ${res.status}`);
    }
    const json = await res.json();
    const row = (json as any)?.results?.[0];
    if (!row) return null;
    const ofda = row.openfda ?? {};
    const clip = (s: any) => {
        const t = Array.isArray(s) ? s.join(' ') : String(s ?? '');
        return t.length > 500 ? t.slice(0, 497) + '…' : t;
    };
    return {
        brandName: Array.isArray(ofda.brand_name) ? ofda.brand_name[0] : '',
        genericName: Array.isArray(ofda.generic_name) ? ofda.generic_name[0] : '',
        manufacturer: Array.isArray(ofda.manufacturer_name) ? ofda.manufacturer_name[0] : '',
        indications: clip(row.indications_and_usage),
        warnings: clip(row.boxed_warning ?? row.warnings),
        approvalDate: '',   // openFDA doesn't expose first-approval date in label endpoint; derive externally if needed
    };
}

// ─── Unified innovation summary (for Deep Research prompt injection) ──────
// Mirror getMacroSummaryText / getCryptoSummaryText. Used by thematic /
// biotech / pharma / semis workflows to inject patent + trial + FDA
// signal into the prompt.

export async function getInnovationSummaryText(opts: {
    company?: string;        // e.g. "Eli Lilly" — sponsor / assignee filter
    drug?: string;           // e.g. "Mounjaro"
    cpc?: string;            // CPC prefix e.g. "G06N" for ML, "C12N" for biotech
    condition?: string;      // e.g. "type 2 diabetes"
} = {}): Promise<string> {
    const blocks: string[] = [];

    const [patents, trials, events] = await Promise.allSettled([
        opts.company || opts.cpc
            ? searchPatents({ assignee: opts.company, cpc: opts.cpc, limit: 5 })
            : Promise.resolve([] as PatentRecord[]),
        opts.condition || opts.company
            ? searchClinicalTrials({
                condition: opts.condition,
                sponsor: opts.company,
                status: ['RECRUITING', 'ACTIVE_NOT_RECRUITING'],
                limit: 5,
            })
            : Promise.resolve([] as TrialRecord[]),
        opts.drug ? fetchDrugAdverseEvents(opts.drug, 5) : Promise.resolve([] as DrugEventCount[]),
    ]);

    if (patents.status === 'fulfilled' && patents.value.length > 0) {
        const lines = patents.value.map(p =>
            `• ${p.patentNumber} (${p.grantDate}) — ${p.title}${p.assignees.length ? ' [' + p.assignees[0] + ']' : ''}`,
        );
        blocks.push(`RECENT PATENTS (USPTO PatentsView):\n${lines.join('\n')}`);
    }
    if (trials.status === 'fulfilled' && trials.value.length > 0) {
        const lines = trials.value.map(t =>
            `• ${t.nctId} ${t.phase || 'N/A'} ${t.status} — ${t.title}${t.sponsor ? ' [' + t.sponsor + ']' : ''}`,
        );
        blocks.push(`ACTIVE CLINICAL TRIALS (ClinicalTrials.gov):\n${lines.join('\n')}`);
    }
    if (events.status === 'fulfilled' && events.value.length > 0) {
        const lines = events.value.map(e => `• ${e.term}: ${e.count.toLocaleString()} reports`);
        blocks.push(`FAERS ADVERSE-EVENT TOP TERMS (openFDA):\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
}
