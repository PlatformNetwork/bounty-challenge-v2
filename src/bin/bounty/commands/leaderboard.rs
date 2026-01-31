//! Leaderboard command

use crate::style::*;
use anyhow::Result;

pub async fn run(rpc: &str, limit: usize) -> Result<()> {
    print_header("Bounty Challenge Leaderboard");

    // Use BountyClient for API consistency
    let client = crate::client::BountyClient::new(rpc);

    match client.get_leaderboard(limit).await {
        Ok(entries) => {
            if entries.is_empty() {
                print_info("No miners with valid bounties yet.");
                return Ok(());
            }

            println!();
            println!(
                "{:>4}  {:<18}  {:>12}  {:>8}  Hotkey",
                "Rank", "GitHub", "Valid Issues", "Score"
            );
            println!("{}", "─".repeat(75));

            for (i, entry) in entries.iter().enumerate() {
                let github = &entry.github_username;
                let issues = entry.issues_resolved_24h as u64;
                let score = entry.weight;
                let hotkey = &entry.hotkey;

                let rank = format!("#{}", i + 1);
                let hotkey_short = if hotkey.len() > 12 {
                    format!("{}...", &hotkey[..12])
                } else {
                    hotkey.to_string()
                };

                let rank_styled = if i == 0 {
                    style_yellow(&rank)
                } else if i < 3 {
                    style_cyan(&rank)
                } else {
                    rank
                };

                println!(
                    "{:>4}  {:<18}  {:>12}  {:>8.4}  {}",
                    rank_styled,
                    github,
                    issues,
                    score,
                    style_dim(&hotkey_short)
                );
            }

            println!();
            println!("Total miners: {}", entries.len());
        }
        Err(e) => {
            print_error(&format!("Failed to fetch leaderboard: {}", e));
        }
    }

    Ok(())
}
