//! Test gh CLI integration
//! Run with: cargo run --example test_gh_cli

use bounty_challenge::{GhCli, GhIssue};

fn main() {
    println!("=== Testing gh CLI Rust integration ===\n");
    
    // Test 1: Check if gh is available
    println!("1. Checking gh CLI availability...");
    if GhCli::is_available() {
        println!("   ✓ gh CLI is available");
    } else {
        println!("   ✗ gh CLI NOT available");
        return;
    }
    
    // Test 2: Check rate limit
    println!("\n2. Checking GitHub API rate limit...");
    match GhCli::check_rate_limit() {
        Ok(rate) => {
            println!("   ✓ Rate limit: {}/{} remaining", rate.remaining, rate.limit);
            println!("   ✓ Resets in {} seconds", rate.seconds_until_reset());
            if rate.is_low() {
                println!("   ⚠ WARNING: Rate limit is LOW!");
            }
        }
        Err(e) => {
            println!("   ✗ Failed to check rate limit: {}", e);
        }
    }
    
    // Test 3: List issues from bounty-challenge repo
    println!("\n3. Listing issues from platformnetwork/bounty-challenge...");
    let gh = GhCli::new("platformnetwork", "bounty-challenge");
    match gh.list_all_issues() {
        Ok(issues) => {
            println!("   ✓ Found {} issues", issues.len());
            
            // Count by state
            let open = issues.iter().filter(|i| !i.is_closed()).count();
            let closed = issues.iter().filter(|i| i.is_closed()).count();
            let valid = issues.iter().filter(|i| i.is_valid_bounty()).count();
            let invalid = issues.iter().filter(|i| i.has_invalid_label()).count();
            
            println!("   - Open: {}", open);
            println!("   - Closed: {}", closed);
            println!("   - Valid bounties (closed+valid label): {}", valid);
            println!("   - Has invalid label: {}", invalid);
            
            // Show first 3 valid bounties
            println!("\n   Sample valid bounties:");
            for issue in issues.iter().filter(|i| i.is_valid_bounty()).take(3) {
                println!("   - #{}: {} by @{}", issue.number, issue.title, issue.author.login);
                println!("     Labels: {:?}", issue.label_names());
            }
            
            // Test conversion to GitHubIssue
            println!("\n   Testing conversion to GitHubIssue format...");
            if let Some(first) = issues.first() {
                let github_issue = first.to_github_issue();
                println!("   ✓ Converted issue #{} successfully", github_issue.number);
                println!("     - html_url: {}", github_issue.html_url);
                println!("     - user.login: {}", github_issue.user.login);
            }
        }
        Err(e) => {
            println!("   ✗ Failed to list issues: {}", e);
        }
    }
    
    // Test 4: List valid bounties only
    println!("\n4. Listing valid bounties only...");
    match gh.list_valid_bounties() {
        Ok(issues) => {
            println!("   ✓ Found {} valid bounties", issues.len());
        }
        Err(e) => {
            println!("   ✗ Failed to list valid bounties: {}", e);
        }
    }
    
    // Test 5: Get a single issue
    println!("\n5. Fetching single issue #436...");
    match gh.get_issue(436) {
        Ok(issue) => {
            println!("   ✓ Issue #{}: {}", issue.number, issue.title);
            println!("   - State: {}", issue.state);
            println!("   - Author: @{}", issue.author.login);
            println!("   - Labels: {:?}", issue.label_names());
            println!("   - Valid bounty: {}", issue.is_valid_bounty());
        }
        Err(e) => {
            println!("   ✗ Failed to get issue: {}", e);
        }
    }
    
    println!("\n=== All tests passed! ===");
}
