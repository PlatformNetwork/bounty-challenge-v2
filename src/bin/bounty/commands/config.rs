//! Config command - show challenge configuration

use crate::style::*;
use anyhow::Result;

pub async fn run(rpc: &str) -> Result<()> {
    print_header("Challenge Configuration");

    // Use BountyClient for API consistency
    let client = crate::client::BountyClient::new(rpc);

    match client.get_stats().await {
        Ok(stats) => {
            println!();
            println!(
                "Challenge ID:     {}",
                style_cyan(stats["challenge_id"].as_str().unwrap_or("?"))
            );
            println!(
                "Version:          {}",
                stats["version"].as_str().unwrap_or("?")
            );
            if let Some(total) = stats["total_bounties"].as_u64() {
                println!("Total Bounties:   {}", total);
            }
            if let Some(miners) = stats["total_miners"].as_u64() {
                println!("Active Miners:    {}", miners);
            }
        }
        Err(e) => {
            print_error(&format!("Failed to fetch config: {}", e));
        }
    }

    println!();
    println!("{}", style_bold("Target Repository:"));
    println!("  https://github.com/PlatformNetwork/bounty-challenge");
    println!();
    println!("{}", style_bold("Valid Issue Criteria:"));
    println!("  - Issue must be closed");
    println!("  - Issue must have '{}' label", style_green("valid"));
    println!("  - You must be the issue author");
    println!("  - Issue must not be already claimed");

    Ok(())
}
