// DadOS source policy.
// Discovery sources identify potentially interesting new consumer hardware.
// Validation sources add weight when they independently test/review a product.
//
// Keep RSS attribution + source URLs in stored recommendations.
// Do not republish full article bodies.

export const SOURCES = [
  {
    name: "The Verge",
    role: "discovery",
    feed: "https://www.theverge.com/rss/index.xml",
    weight: 1.05
  },
  {
    name: "Engadget",
    role: "discovery",
    feed: "https://www.engadget.com/rss.xml",
    weight: 1.0
  },
  {
    name: "TechCrunch",
    role: "discovery",
    feed: "https://techcrunch.com/feed/",
    weight: 0.85
  },
  {
    name: "Ars Technica — Gear & Gadgets",
    role: "validation",
    feed: "https://feeds.arstechnica.com/arstechnica/gadgets",
    weight: 1.2
  },
  {
    name: "Tom's Guide",
    role: "validation",
    feed: "http://bit.ly/Toms_RSS",
    weight: 1.15
  }
];

export const POSITIVE_TERMS = [
  "camera","drone","gadget","glasses","wearable","travel","charger","battery",
  "router","earbuds","headphones","projector","robot","vacuum","smart home",
  "portable","accessory","new product","launch","announced","hands-on","review",
  "action camera","360","translation","gps","garmin","anker","sony","meta",
  "insta360","gopro","dji","apple","samsung","bose"
];

export const NEGATIVE_TERMS = [
  "funding round","raises $","valuation","ipo","earnings","layoffs","policy",
  "lawsuit","crypto","bitcoin","enterprise software","data center","datacenter",
  "venture capital","stock price","subscription deal","streaming show",
  "movie","tv series","rumor","leak says","politics"
];
