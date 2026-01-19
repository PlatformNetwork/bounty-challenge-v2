//! Bounty Challenge Server
//!
//! Rewards miners for valid GitHub issues

use std::sync::Arc;
use std::time::Duration;

use bounty_challenge::{BountyChallenge, PgStorage};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

const SYNC_INTERVAL_SECS: u64 = 300; // 5 minutes

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    info!("Starting Bounty Challenge Server");

    // Initialize PostgreSQL storage (required)
    let database_url = std::env::var("DATABASE_URL").map_err(|_| {
        error!("DATABASE_URL environment variable is required");
        anyhow::anyhow!("DATABASE_URL not set")
    })?;
    
    let storage = Arc::new(PgStorage::new(&database_url).await?);
    info!("PostgreSQL storage initialized");

    // Create challenge
    let challenge = Arc::new(BountyChallenge::new_with_storage(storage.clone()));

    // Get server config from environment
    let host = std::env::var("CHALLENGE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("CHALLENGE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    // Start background GitHub sync task (every 5 minutes)
    let sync_storage = storage.clone();
    tokio::spawn(async move {
        // Initial sync after 10 seconds
        tokio::time::sleep(Duration::from_secs(10)).await;
        
        let mut interval = tokio::time::interval(Duration::from_secs(SYNC_INTERVAL_SECS));
        loop {
            interval.tick().await;
            if let Err(e) = sync_all_repos(&sync_storage).await {
                error!("GitHub sync failed: {}", e);
            }
        }
    });
    info!("Background GitHub sync started (every {} seconds)", SYNC_INTERVAL_SECS);

    // Run our custom server with all endpoints
    bounty_challenge::server::run_server(&host, port, challenge, storage).await?;

    Ok(())
}

/// Sync all target repos from GitHub
async fn sync_all_repos(storage: &PgStorage) -> anyhow::Result<()> {
    let repos = storage.get_active_repos().await?;
    
    if repos.is_empty() {
        warn!("No target repos configured for sync");
        return Ok(());
    }

    info!("Starting GitHub sync for {} repos", repos.len());
    
    let mut total_synced = 0;
    for repo in repos {
        match bounty_challenge::server::sync_repo(storage, &repo.owner, &repo.repo).await {
            Ok(count) => {
                if count > 0 {
                    info!("Synced {} issues from {}/{}", count, repo.owner, repo.repo);
                }
                total_synced += count;
            }
            Err(e) => {
                error!("Failed to sync {}/{}: {}", repo.owner, repo.repo, e);
            }
        }
    }
    
    if total_synced > 0 {
        info!("GitHub sync complete: {} new/updated issues", total_synced);
    }
    
    Ok(())
}
