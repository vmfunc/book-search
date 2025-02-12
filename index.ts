import axios from 'axios';
import type { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

interface SearchResult {
    source: string;
    title: string;
    year: string;
    url: string;
    description: string;
}

interface ArchiveOrgResponse {
    response?: {
        docs?: Array<{
            identifier: string;
            title: string;
            year?: string;
            description?: string;
        }>;
    };
}

interface GoogleBooksResponse {
    items?: Array<{
        volumeInfo?: {
            title?: string;
            publishedDate?: string;
            description?: string;
            previewLink?: string;
        };
    }>;
}

interface RedditResponse {
    data?: {
        children?: Array<{
            data: {
                title: string;
                created_utc: number;
                permalink: string;
                selftext?: string;
            };
        }>;
    };
}

interface WebSearchResult {
    title: string;
    url: string;
    description: string;
    date?: string;
}

interface DigitalLibrary {
    name: string;
    url: string;
    params: Record<string, string>;
    selector: {
        container: string;
        title: string;
        date?: string;
        description?: string;
        link: string;
    };
}

class ArchiveSearcher {
    private readonly client: AxiosInstance;
    private readonly magazine_name: string;

    constructor(magazineName: string) {
        this.magazine_name = magazineName;
        this.client = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
    }

    private async searchArchiveOrg(): Promise<SearchResult[]> {
        try {
            const baseUrl = "https://archive.org/advancedsearch.php";
            const params = {
                q: `title:("${this.magazine_name}") AND mediatype:(texts)`,
                'fl[]': ['identifier', 'title', 'year', 'mediatype', 'description'],
                'sort[]': ['year asc'],
                rows: '100',
                output: 'json'
            };

            const { data } = await this.client.get<ArchiveOrgResponse>(baseUrl, { params });
            const results: SearchResult[] = [];

            if (data.response?.docs) {
                for (const item of data.response.docs) {
                    if (this.verifyMagazineIdentity(item.title)) {
                        results.push({
                            source: 'archive.org',
                            title: item.title,
                            year: item.year || 'Unknown',
                            url: `https://archive.org/details/${item.identifier}`,
                            description: item.description || ''
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('Error searching archive.org:', error);
            return [];
        }
    }

    private async searchGoogleBooks(): Promise<SearchResult[]> {
        try {
            const baseUrl = "https://www.googleapis.com/books/v1/volumes";
            const params = {
                q: `intitle:"${this.magazine_name}"`,
                maxResults: 40
            };

            const { data } = await this.client.get<GoogleBooksResponse>(baseUrl, { params });
            const results: SearchResult[] = [];

            if (data.items) {
                for (const item of data.items) {
                    const volumeInfo = item.volumeInfo;
                    if (volumeInfo?.title) {
                        const year = this.extractYear(volumeInfo.publishedDate || '');
                        if (year !== 'Unknown' && this.verifyMagazineIdentity(volumeInfo.title)) {
                            results.push({
                                source: 'google_books',
                                title: volumeInfo.title,
                                year,
                                url: volumeInfo.previewLink || '',
                                description: volumeInfo.description || ''
                            });
                        }
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('Error searching Google Books:', error);
            return [];
        }
    }

    private async searchRedditArchives(): Promise<SearchResult[]> {
        const subreddits = ['magazines', 'archival', 'vintageculture', 'OldSchoolCool'];
        const results: SearchResult[] = [];

        for (const subreddit of subreddits) {
            try {
                const url = `https://www.reddit.com/r/${subreddit}/search.json`;
                const params = {
                    q: `title:"${this.magazine_name}"`,
                    restrict_sr: 'on',
                    sort: 'top',
                    t: 'all'
                };

                const { data } = await this.client.get<RedditResponse>(url, { params });

                if (data.data?.children) {
                    for (const post of data.data.children) {
                        const postData = post.data;
                        if (this.verifyMagazineIdentity(postData.title)) {
                            const year = new Date(postData.created_utc * 1000).getFullYear().toString();
                            results.push({
                                source: `reddit/r/${subreddit}`,
                                title: postData.title,
                                year,
                                url: `https://reddit.com${postData.permalink}`,
                                description: (postData.selftext || '').slice(0, 200)
                            });
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`Error searching Reddit ${subreddit}:`, error);
            }
        }

        return results;
    }

    private async searchGeneralWeb(): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const searchEngines = [
            {
                name: 'Google',
                url: 'https://www.google.com/search',
                params: { q: `"${this.magazine_name}" magazine`, num: '100' } as Record<string, string>,
                selector: {
                    container: '.g',
                    title: '.LC20lb',
                    description: '.VwiC3b',
                    link: 'a[href]'
                }
            },
            {
                name: 'Bing',
                url: 'https://www.bing.com/search',
                params: { q: `"${this.magazine_name}" magazine`, count: '50' } as Record<string, string>,
                selector: {
                    container: '.b_algo',
                    title: 'h2',
                    description: '.b_caption p',
                    link: 'a[href]'
                }
            }
        ];

        for (const engine of searchEngines) {
            try {
                const params = new URLSearchParams(engine.params);
                const { data } = await this.client.get(engine.url, { params });
                const $ = cheerio.load(data);

                $(engine.selector.container).each((_, element) => {
                    const title = $(element).find(engine.selector.title).text().trim();
                    const url = $(element).find(engine.selector.link).attr('href');
                    const description = $(element).find(engine.selector.description).text().trim();

                    if (title && url && this.verifyMagazineIdentity(title)) {
                        const year = this.extractYear(title + ' ' + description);
                        results.push({
                            source: engine.name,
                            title,
                            year,
                            url,
                            description
                        });
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (error) {
                console.error(`Error searching ${engine.name}:`, error);
            }
        }

        return results;
    }

    private async searchDigitalLibraries(): Promise<SearchResult[]> {
        const libraries: DigitalLibrary[] = [
            {
                name: 'HathiTrust',
                url: 'https://babel.hathitrust.org/cgi/ls',
                params: { q: this.magazine_name },
                selector: {
                    container: '.record',
                    title: '.title',
                    date: '.date',
                    description: '.description',
                    link: '.title a'
                }
            },
            {
                name: 'Internet Archive',
                url: 'https://archive.org/search.php',
                params: { query: this.magazine_name },
                selector: {
                    container: '.item-ia',
                    title: '.ttl',
                    date: '.date',
                    description: '.C234',
                    link: '.ttl'
                }
            },
            {
                name: 'Digital Public Library of America',
                url: 'https://dp.la/search',
                params: { q: this.magazine_name, type: 'text' },
                selector: {
                    container: '.search-result',
                    title: '.title',
                    description: '.description',
                    link: '.title a'
                }
            },
            {
                name: 'WorldCat',
                url: 'https://www.worldcat.org/search',
                params: { q: this.magazine_name },
                selector: {
                    container: '.result',
                    title: '.title',
                    date: '.date',
                    description: '.description',
                    link: '.title a'
                }
            }
        ];

        const results: SearchResult[] = [];

        for (const library of libraries) {
            try {
                const { data } = await this.client.get(library.url, { params: library.params });
                const $ = cheerio.load(data);

                $(library.selector.container).each((_, element) => {
                    const title = $(element).find(library.selector.title).text().trim();
                    if (title && this.verifyMagazineIdentity(title)) {
                        const year = this.extractYear($(element).text());
                        results.push({
                            source: library.name,
                            title,
                            year,
                            url: new URL($(element).find(library.selector.link).attr('href') || '', library.url).toString(),
                            description: $(element).find(library.selector.description).text().trim()
                        });
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`Error searching ${library.name}:`, error);
            }
        }

        return results;
    }

    private verifyMagazineIdentity(title: string): boolean {
        if (!title) return false;

        const cleanTitle = title.toLowerCase().replace(/[^\w\s]/g, '');
        const cleanTarget = this.magazine_name.toLowerCase().replace(/[^\w\s]/g, '');

        return cleanTitle === cleanTarget || cleanTitle.includes(cleanTarget);
    }

    private extractYear(text: string): string {
        const yearPatterns = [
            /\b20\d{2}\b/,
            /\b\d{4}\b/
        ];

        for (const pattern of yearPatterns) {
            const match = text.match(pattern);
            if (match) {
                const year = parseInt(match[0]);
                if (this.isYearInRange(year.toString())) {
                    return year.toString();
                }
            }
        }

        return 'Unknown';
    }

    private isYearInRange(year: string): boolean {
        const yearNum = parseInt(year);
        return !isNaN(yearNum) && yearNum >= 2000 && yearNum <= 2025;
    }

    private deduplicateResults(results: SearchResult[]): SearchResult[] {
        const seen = new Set<string>();
        return results.filter(result => {
            if (seen.has(result.url)) {
                return false;
            }
            seen.add(result.url);
            return true;
        });
    }

    public async searchAll(): Promise<SearchResult[]> {
        const searchMethods = [
            this.searchArchiveOrg.bind(this),
            this.searchGoogleBooks.bind(this),
            this.searchRedditArchives.bind(this),
            this.searchDigitalLibraries.bind(this),
            this.searchGeneralWeb.bind(this)
        ];

        try {
            const results = await Promise.all(searchMethods.map(method => method()));
            const allResults = results.flat();
            return this.deduplicateResults(allResults);
        } catch (error) {
            console.error('Error in searchAll:', error);
            return [];
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Please provide a magazine name as an argument.');
        console.error('Usage: node script.js "Name"');
        process.exit(1);
    }

    const magazineName = args[0];
    const searcher = new ArchiveSearcher(magazineName);

    console.log(`Starting comprehensive search for: ${magazineName}`);
    const results = await searcher.searchAll();

    if (results.length > 0) {
        console.log(`\nFound ${results.length} unique results:`);

        const resultsBySource = results.reduce<Record<string, SearchResult[]>>((acc, result) => {
            if (!acc[result.source]) {
                acc[result.source] = [];
            }
            acc[result.source].push(result);
            return acc;
        }, {});

        Object.entries(resultsBySource).forEach(([source, sourceResults]) => {
            console.log(`\n=== Results from ${source} ===`);
            sourceResults.forEach(result => {
                console.log(`\nTitle: ${result.title}`);
                console.log(`Year: ${result.year}`);
                console.log(`URL: ${result.url}`);
                if (result.description) {
                    console.log(`Description: ${result.description.slice(0, 200)}...`);
                }
            });
        });
    } else {
        console.log("No results found.");
    }
}

main().catch(console.error);