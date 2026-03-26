// SEC EDGAR Filing Service
// Fetches SEC filings (10-K, 10-Q, 8-K) from the public EDGAR database

export interface SECFiling {
    filingType: string;
    filingDate: string;
    reportDate: string;
    accessionNumber: string;
    fileNumber: string;
    url: string;
    company: string;
    cik: string;
}

const SEC_BASE_URL = 'https://www.sec.gov';
const USER_AGENT = 'MarketIntelligence research@example.com'; // SEC requires User-Agent with email

export const searchFilings = async (
    companyName: string,
    filingTypes: string[] = ['10-K', '10-Q', '8-K'],
    limit: number = 10
): Promise<SECFiling[]> => {
    try {
        // First, search for the company to get CIK
        const searchUrl = `${SEC_BASE_URL}/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&action=getcompany&output=atom`;

        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`SEC EDGAR API error: ${response.statusText}`);
        }

        const text = await response.text();

        // Parse XML to extract filings (simplified - in production use proper XML parser)
        const filings: SECFiling[] = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        const matches = text.matchAll(entryRegex);

        for (const match of matches) {
            const entry = match[1];

            // Extract filing type
            const typeMatch = entry.match(/<category[^>]*term="([^"]+)"/);
            const filingType = typeMatch ? typeMatch[1] : '';

            if (!filingTypes.includes(filingType)) continue;

            // Extract other details
            const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
            const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
            const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);

            if (linkMatch && titleMatch) {
                filings.push({
                    filingType,
                    filingDate: updatedMatch ? updatedMatch[1].split('T')[0] : '',
                    reportDate: '',
                    accessionNumber: '',
                    fileNumber: '',
                    url: linkMatch[1],
                    company: companyName,
                    cik: '',
                });
            }

            if (filings.length >= limit) break;
        }

        return filings;
    } catch (error) {
        console.error('SEC EDGAR search error:', error);
        return [];
    }
};

export const getFilingContent = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch filing: ${response.statusText}`);
        }

        return await response.text();
    } catch (error) {
        console.error('Error fetching filing content:', error);
        return '';
    }
};
