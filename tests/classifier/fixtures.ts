import type { CategoryId } from "../../lib/completeness/profile.ts"

/**
 * Hand-labeled ground truth. Every row is a REAL Firecrawl search result for
 * "commercial espresso machine manufacturers" (+ entity/trade query variants),
 * pulled live — not synthetic. Labels are our own analyst-style judgment of the
 * source TYPE (who publishes it), which is topic-independent. `expectedMatch` is
 * derived from the demo profile's include set, not judged separately.
 *
 * `extractable: false` marks sources Firecrawl can surface but not reliably
 * scrape (Reddit, Quora, video). For a completeness audit those still count as
 * wanted hits — "here's a source you missed, flagged for manual review" — so
 * they stay in discovery; the flag just tells the pipeline it can't cite them.
 */

export type Fixture = {
  id: string
  url: string
  title: string
  description: string
  expectedCategory: CategoryId
  expectedMatch: boolean
  extractable: boolean
  note?: string
}

export const FIXTURES: Fixture[] = [
  {
    id: "procoffeegear-collection",
    url: "https://procoffeegear.com/collections/commercial-espresso-machines",
    title: "Commercial Espresso Machines | Pro Coffee Gear",
    description:
      "Pro Coffee Gear carries commercial espresso machines from the brands that define the category: La Cimbali, Nuova Simonelli, Sanremo, Rocket Espresso, Wega.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "coffeemachinedepot-new",
    url: "https://www.coffeemachinedepot.com/collections/new-commercial-espresso-machines",
    title: "New Commercial Espresso Machines",
    description:
      "Experience the latest in coffee innovation with our new arrivals of espresso machines, featuring brands like Sanremo, LA Marzocco, and Victoria Arduino.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "clivecoffee-commercial",
    url: "https://clivecoffee.com/collections/commercial",
    title: "Commercial Espresso Machines & Grinders - Clive Coffee",
    description:
      "Commercial espresso machines and grinders from La Marzocco, Mahlkönig, and Rocket. Curated for cafés and mobile coffee businesses.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "seattlecoffeegear-semiauto",
    url: "https://www.seattlecoffeegear.com/collections/commercial-semi-automatic",
    title: "Commercial Semi-Automatic Espresso Machines for Cafes",
    description:
      "Commercial Semi-automatic Espresso Machines ; Nuova Simonelli (4) ; Rancilio (9) ; Rocket Espresso (3) ; Victoria Arduino (3).",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "chriscoffee-commercial",
    url: "https://www.chriscoffee.com/collections/commercial-espresso-machines",
    title: "Italian Commercial Espresso Machines",
    description:
      "Buy professional commercial espresso machines for your business. Browse Top Italian Espresso Maker brands & get the Best Professional Coffee Machine.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "prima-coffee-cafe",
    url: "https://prima-coffee.com/cafe/espresso-machines",
    title: "Commercial Espresso Machines - For Quality-Minded Cafes",
    description:
      "To meet the needs of cafes and coffee shops, we've carefully selected a list of top-notch espresso machine manufacturers: Astoria, La Marzocco, Nuova Simonelli.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "lamarzocco-usa",
    url: "https://lamarzoccousa.com/",
    title: "La Marzocco USA - Handmade in Florence",
    description:
      "Espresso machines and grinders trusted by the world's finest coffee roasters, cafès, and restaurants for their reliability, durability, and timeless aesthetics.",
    expectedCategory: "manufacturer",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "reddit-coffee-favourite",
    url: "https://www.reddit.com/r/Coffee/comments/9h3a7d/whats_everyones_favourite_commercial_espresso/",
    title: "What's everyone's favourite commercial espresso machine? : r/Coffee",
    description:
      "The ones we are currently looking at are: La Marzocco Linea PB, Slayer Steam, Nuova Simonelli White Eagle, San Remo Racer.",
    expectedCategory: "community_forum",
    expectedMatch: true,
    extractable: false,
    note: "Large general forum, high value but not scrapeable — surface + flag for manual review.",
  },
  {
    id: "reddit-espresso-which",
    url: "https://www.reddit.com/r/espresso/comments/19ffzai/which_commercial_espresso_machine/",
    title: "Which Commercial Espresso Machine…",
    description:
      "The new Mazzer line is excellent. I'm really impressed by them, especially for ease of service. Mahlkonig is a close second in my mind.",
    expectedCategory: "community_forum",
    expectedMatch: true,
    extractable: false,
  },
  {
    id: "coffeeforums-lamarzocco-simonelli",
    url: "https://www.coffeeforums.com/threads/commercial-espresso-machine-la-mazzorco-vs-nuova-simonelli.10483/",
    title: "Commercial Espresso machine - La Mazzorco vs Nuova Simonelli?",
    description:
      "It depends on the model you choose but Nuova Simonelli is easy to fix, parts seems to be cheaper and they are built like tanks.",
    expectedCategory: "niche_forum",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "baristaexchange-simonelli-marzocco",
    url: "https://www.baristaexchange.com/forum/topics/simonelli-vs-la-marzocco",
    title: "Simonelli vs. La Marzocco - Barista Exchange",
    description:
      "They both have their strenghts and drawbacks: Simonelli: They have one of the most stable exchangers on the market. They are pretty solid.",
    expectedCategory: "niche_forum",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "home-barista-mini-musica",
    url: "https://www.home-barista.com/advice/la-marzocco-linea-mini-or-nuova-simonelli-musica-help-me-choose-t45493-10.html",
    title: "La Marzocco Linea Mini or Nuova Simonelli Musica? Help me choose",
    description:
      "The Mini is a totally different beast. It is much more expensive. It's heavy, has two boilers (water and steam) so, maximum flexibility and maximum cost.",
    expectedCategory: "niche_forum",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "quora-good-commercial",
    url: "https://www.quora.com/What-are-some-good-commercial-espresso-machines-for-a-coffee-shop-or-restaurant",
    title:
      "What are some good commercial espresso machines for a coffee shop or restaurant?",
    description: "",
    expectedCategory: "community_forum",
    expectedMatch: true,
    extractable: false,
  },
  {
    id: "sca-certified-equipment",
    url: "https://sca.coffee/sca-certified/commercial-equipment",
    title: "SCA Certified Commercial Equipment Program",
    description:
      "The SCA Certified Espresso Machine mark is awarded to machines designed and engineered to give baristas quality and precision control over their brewing.",
    expectedCategory: "trade_pub",
    expectedMatch: true,
    extractable: true,
    note: "Specialty Coffee Association — the anchor long-tail industry source the SEO-ranked storefronts bury.",
  },
  {
    id: "visionsespresso-blog-howto",
    url: "https://visionsespresso.com/blog/how-to-choose-a-commercial-espresso-machine/",
    title: "How to Choose a Commercial Espresso Machine",
    description:
      "A Kees Van Der Westen or La Marzocco Strada requires a barista who can read the machine and make adjustments. A Nuova Simonelli Appia Life with…",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "prima-coffee-blog-carts",
    url: "https://prima-coffee.com/blog/the-best-espresso-machines-for-coffee-carts-in-2025/",
    title: "The Best Espresso Machines For Coffee Carts In 2025",
    description:
      "La Marzocco Linea Mini; La Spaziale Lucca A53 Direct Plumb; Nuova Simonelli Appia Life Compact 2-Group … commercial grade and rated for all.",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "katom-learning-center",
    url: "https://www.katom.com/learning-center/la-marzocco-vs-nuova-simonelli-which-espresso-machine-is-better.html",
    title: "La Marzocco vs. Nuova Simonelli: Which Espresso Machine Is Better?",
    description:
      "Both La Marzocco and Nuova Simonelli are premium espresso maker brands known for their stainless steel construction, thermal stability, and durability.",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "capitalcityroasters-guide",
    url: "https://capitalcityroasters.com/commercial-espresso-machine/",
    title: "The Ultimate Guide to Finding a Commercial Espresso Machine",
    description:
      "In this section, we will review two of the best 2 group commercial espresso machines for 2024: the La Marzocco Linea PB and the Nuova Simonelli.",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "versus-linea-aurelia",
    url: "https://versus.com/en/la-marzocco-linea-pb-2-group-vs-nuova-simonelli-aurelia-ii-volumetric-2-group",
    title: "La Marzocco Linea PB 2 Group vs Nuova Simonelli Aurelia II…",
    description:
      "It comes with a commercial style steam wand as opposed to a pannarello steam wand. These are harder to master but can allow you to produce better milk.",
    expectedCategory: "other",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "youtube-buying-guide",
    url: "https://www.youtube.com/watch?v=1hlfDmTddNg",
    title: "A Guide To Buying A Commercial Espresso Machine (Victoria…)",
    description:
      "TOP 5 Best Commercial Espresso Machines 2026 | Perfect for Serious Coffee Lovers.",
    expectedCategory: "other",
    expectedMatch: false,
    extractable: false,
  },
  {
    id: "thehorecastore-blog-versus",
    url: "https://www.thehorecastore.com/blog/nuova-simonelli-vs-la-marzocco-which-espresso-machine-brand-is-best-for-growing-cafes",
    title:
      "Nuova Simonelli vs La Marzocco: Which Espresso Machine Brand Is Best…",
    description:
      "Nuova Simonelli is known for user-friendly operation, workflow efficiency, and strong value for money, while La Marzocco is recognized for…",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
    note: "Nuance: HORECA is B2B/trade-flavored, but it's still a retailer's marketing blog — vendor_blog, not trade_pub.",
  },
  {
    id: "unic-espresso-news-trends",
    url: "https://www.unic-espresso.com/en-us/news-events/trends/choose-best-commercial-espresso-machine-for-coffee-shops/",
    title: "Choose the Best Commercial Espresso Machine for Coffee Shops",
    description:
      "Looking for the best commercial espresso machine for your coffee shop? Discover top-rated models, key features and buying advice.",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
    note: "Nuance: URL says news/trends, but Unic is a manufacturer publishing buying-advice content marketing — vendor_blog.",
  },
  {
    id: "bestcoffeegear-tradeshows",
    url: "https://www.bestcoffeegear.com/tradeshows",
    title: "Trade Shows & Events | Commercial Espresso Machines",
    description:
      "Trade shows and industry events allow customers to see commercial coffee equipment in person, compare super automatic espresso machine models, and connect.",
    expectedCategory: "retailer",
    expectedMatch: false,
    extractable: true,
    note: "Nuance: a retailer's page ABOUT trade shows — the site is a store, so retailer, not trade_pub.",
  },
  {
    id: "busybeancoffee-blog-wholesale",
    url: "https://blog.busybeancoffee.com/best-wholesale-espresso-machines-restaurants",
    title: "Best Wholesale Espresso Machines for Restaurants…",
    description:
      "Discover the top wholesale espresso machines for restaurants and cafes in 2026. Compare features, pricing, reliability, and suppliers to find…",
    expectedCategory: "vendor_blog",
    expectedMatch: false,
    extractable: true,
  },

  // --- mainstream_press: big general-audience publishers. The "SEO winners"
  // the client is drowning in — high-authority, top-ranked, NOT wanted. This is
  // the category a lexical/consensus ranker structurally surfaces first.
  {
    id: "wired-best-espresso",
    url: "https://www.wired.com/gallery/best-espresso-machines/",
    title: "The Best Espresso Machines for Home Baristas",
    description:
      "Updated March 2026: After recent testing, I've changed my top pick to the Fellow Series 1 Espresso Machine, moving the previous top pick.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
    note: "Anchor: Wired — the exact big-tech-publisher SEO winner the customer complained buries the long tail.",
  },
  {
    id: "verge-woods-espresso",
    url: "https://www.theverge.com/tech/942873/ikape-cera-portable-espresso-review",
    title: "I went to the woods to drink surprisingly great espresso | The Verge",
    description:
      "$200 Ikape performed surprisingly well. It features a powerful 20-bar pump and a 13,500mAh battery that recharges over USB-C.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "nyt-wirecutter-espresso",
    url: "https://www.nytimes.com/wirecutter/reviews/best-espresso-machine-grinder-and-accessories-for-beginners/",
    title: "The Best Home Espresso Machine | Reviews by Wirecutter",
    description:
      "After testing dozens of machines, we think the Profitec Go is the best option for new and skilled enthusiasts alike.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
    note: "Nuance: NYT Wirecutter is an editorial product-review vertical — mainstream_press, NOT a store's vendor_blog.",
  },
  {
    id: "cnet-best-espresso",
    url: "https://www.cnet.com/home/kitchen-and-household/best-espresso-machine/",
    title: "The Best Espresso Machines of 2026 After Testing More Than a Dozen",
    description:
      "The Breville Barista Express ticks the most boxes of any machine we tested, with solid performance, features and a reasonable price.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
  },
  {
    id: "seriouseats-coffee-makers",
    url: "https://www.seriouseats.com/best-coffee-makers-7484583",
    title: "The 14 Best Coffee Makers of 2026, Tested & Reviewed - Serious Eats",
    description:
      "The best drip coffee maker is from Ratio Six. Looking for an espresso machine? The Breville Bambino Plus is the best option for most people.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
    note: "Nuance: established food-media editorial — distinct from a store's marketing blog (vendor_blog).",
  },
  {
    id: "forbes-vetted-espresso",
    url: "https://www.forbes.com/sites/forbes-personal-shopper/article/best-espresso-machine/",
    title: "Best Espresso Machines 2026 | Tested - Forbes Vetted",
    description:
      "The Breville Barista Express Impress is our pick for the best espresso machine overall, based on our rigorous tests.",
    expectedCategory: "mainstream_press",
    expectedMatch: false,
    extractable: true,
  },

  // --- regional_press: local/regional news covering coffee businesses. The
  // category the customer cares MOST about and that essentially never ranks —
  // wanted, and the anchor for the "here's what you're missing" demo.
  {
    id: "wpri-society-coffee",
    url: "https://www.wpri.com/news/local-news/providence/society-coffee-bar-opens-first-rhode-island-location/",
    title: "Society Coffee Bar opens first Rhode Island location - WPRI.com",
    description:
      "The coffee shop opened up its fourth location and the first in Rhode Island. The new spot, located on North Broadway in East Providence.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
    note: "Anchor: local TV news — exactly the regional press the customer says their search never surfaces.",
  },
  {
    id: "golocalprov-daves",
    url: "https://www.golocalprov.com/food/new-daves-coffee-to-open-craft-coffee-bar-in-providence",
    title: "NEW: Dave's Coffee to Open Craft Coffee Bar in Providence",
    description:
      "Dave's Coffee, a Rhode Island based craft coffee roaster and cafe, has announced it will open a custom-built craft coffee bar at 341 South.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "johnsoncountypost-current-state",
    url: "https://johnsoncountypost.com/2026/06/12/current-state-coffee-roasters-shawnee-288583/",
    title: "New coffee shop Current State Coffee Roasters now open in Shawnee",
    description:
      "Owners Nick Robertson, David Weber and Josh Greenlee opened their new coffee shop and roastery on Monday in downtown Shawnee.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "bizjournals-southern-grounds",
    url: "https://www.bizjournals.com/charlotte/news/2026/06/15/southern-grounds-coffee-plaza-midwood-dilworth.html",
    title: "Coffee chain Southern Grounds selects Charlotte for first expansion",
    description:
      "Southern Grounds & Co. is expanding to Charlotte with two new locations planned for the Dilworth and Plaza Midwood neighborhoods.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
    note: "Regional business journal — local business press, a wanted long-tail source.",
  },
  {
    id: "ibj-motw-expansion",
    url: "https://www.ibj.com/articles/local-coffeeshop-chain-planning-aggressive-u-s-expansion",
    title: "Local coffeeshop chain planning aggressive U.S. expansion",
    description:
      "After opening its fourth Indianapolis-area coffee shop in April, MOTW Coffee and Pastries is embarking on an aggressive growth strategy.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
  },
  {
    id: "patch-jersey-city-espresso",
    url: "https://patch.com/new-jersey/jersey-city/new-espresso-bar-helps-jolt-coffee-scene-jersey-city",
    title: "New Espresso Bar Helps Jolt The Coffee Scene In Jersey City - Patch",
    description:
      "A downtown Jersey City business owner has now opened a different kind of venture: an espresso bar on Newark Avenue.",
    expectedCategory: "regional_press",
    expectedMatch: true,
    extractable: true,
  },
]
