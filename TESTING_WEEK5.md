# Week 5 Testing Guide: Web3 Transaction Stream

## Prerequisites

1. **Alchemy API Setup**
   - Sign up at https://www.alchemy.com/
   - Create an app with Ethereum Mainnet
   - Copy the API key and WebSocket URL
   - Add to `.env`:
     ```
     ALCHEMY_API_KEY=your_api_key
     ALCHEMY_WS_URL=wss://eth-mainnet.g.alchemy.com/v2/your_api_key
     ```

2. **Database Migration**
   - Run migrations to add `last_active_at` column:
     ```bash
     npm run migrate
     ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

## Testing Steps

### 1. Add an EOA Wallet Entity

Visit `/entities` page and add a new entity:
- **Name**: "Test Wallet" (or any label)
- **Type**: EOA Wallet
- **Source**: web3
- **Address**: A real Ethereum address (e.g., `0x1234567890123456789012345678901234567890`)
- **Chain ID**: 1 (Ethereum Mainnet)

**Use a wallet with active transactions** for testing, or:
- **Binance deposit wallet**: `0x28c6c06298d161e40a814280e7db401849714b3e`
- **Coinbase Custody**: `0x70fcc59f2d6e7124356766686ae3e3e6fde666ad`

### 2. Monitor Transaction Stream

Watch the API logs for output like:
```
[web3-stream] subscribed to wallet 550e8400-e29b-41d4-a716-446655440000
[web3-stream] new transaction from Test Wallet: 0.5 ETH
[web3-stream] flushed 4 metrics from 1 wallets
```

### 3. Verify Raw Events

Query the database:
```sql
SELECT * FROM raw_events 
WHERE source = 'web3' AND event_type = 'web3_transaction'
ORDER BY ingest_timestamp DESC LIMIT 5;
```

Expected: Transactions with payload containing from_address, to_address, value_eth, value_usd, etc.

### 4. Verify Daily Metrics

Query the database:
```sql
SELECT metric, value, timestamp FROM entity_metrics_history 
WHERE metric LIKE '%per_day'
ORDER BY timestamp DESC LIMIT 20;
```

Expected metrics:
- `tx_count_per_day`
- `volume_usd_per_day`
- `unique_counterparties_per_day`
- `contracts_interacted_per_day`

### 5. Test Dormancy Detection

#### Simulate a dormant wallet:
1. Create a wallet entity
2. Update the `last_active_at` to 60+ days ago:
   ```sql
   UPDATE entities 
   SET last_active_at = NOW() - INTERVAL '61 days'
   WHERE id = 'wallet_id';
   ```
3. Wait for a new transaction to arrive on that wallet
4. Query incidents to verify CRITICAL incident is created:
   ```sql
   SELECT * FROM incidents 
   WHERE entity_id = 'wallet_id' AND attack_pattern = 'WEB3_004';
   ```

## Expected Success Criteria

- [x] EOA wallet added via form with address validation
- [x] Real transactions streaming into raw_events table
- [x] Daily metrics aggregating into entity_metrics_history
- [x] ETH price fetching from CoinGecko (checked in logs)
- [x] Dormancy detection firing CRITICAL incident on wake-up
- [x] Web3 tab visible on /entities page
- [x] Wallet address displayed (truncated)
- [x] Last active timestamp updating per transaction

## Troubleshooting

### WebSocket Connection Fails
- Verify `ALCHEMY_WS_URL` is correct
- Check network connectivity to Alchemy servers
- Logs will show: `[web3-stream] startup failed: ...`

### No Transactions Arriving
- Wallet may not have recent activity on mainnet
- Try a wallet with known activity (exchanges, contracts)
- Allow 30+ seconds for WebSocket to receive events
- Check Alchemy dashboard for API usage

### Metrics Not Persisting
- Verify `DATABASE_URL` is correct
- Run migrations: `npm run migrate`
- Check PostgreSQL logs for errors
- Metrics flush every 5 minutes

### Dormancy Detection Not Firing
- Verify wallet has `last_active_at` set to 60+ days ago
- Check transaction is actually new (not duplicate payload_hash)
- Look for logs: `[web3-stream] new transaction from ...`
