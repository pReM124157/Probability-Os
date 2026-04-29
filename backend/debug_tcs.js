import { getCompanyOverview, getLiveMarketData } from "./src/services/marketData.service.js";

async function test() {
    console.log("--- TESTING TCS ---");
    const overview = await getCompanyOverview("TCS");
    console.log("FINAL OVERVIEW:", JSON.stringify(overview, null, 2));
    
    const live = await getLiveMarketData("TCS");
    console.log("FINAL LIVE DATA:", JSON.stringify(live, null, 2));
}

test();
