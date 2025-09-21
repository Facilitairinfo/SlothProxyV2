// scraper.js

export async function scrapeLatest() {
  // Placeholder voor NEN + Facilitairnetwerk scraping
  return {
    source: 'scrapeLatest',
    timestamp: Date.now(),
    items: [
      { title: 'NEN update', url: 'https://www.nen.nl/nieuws' },
      { title: 'Facilitairnetwerk nieuws', url: 'https://www.facilitairnetwerk.nl/nieuws' }
    ]
  };
}

export default async function scraper() {
  return {
    source: 'defaultScraper',
    timestamp: Date.now(),
    message: 'Scraper module actief'
  };
}
