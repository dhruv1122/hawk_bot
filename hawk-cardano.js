// 🦅 HAWK - Cardano Pool Scanner Bot
// Detects new liquidity pools on Cardano DEXes (SundaeSwap, Minswap, etc.)

require('dotenv').config();
const BlockFrostAPI = require('@blockfrost/blockfrost-js').BlockFrostAPI;
const CardanoWasm = require('@emurgo/cardano-serialization-lib-nodejs');
const axios = require('axios');
const fs = require('fs');

// 🎯 CARDANO BOT CONFIGURATION
const config = {
    // Blockfrost connection
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID,
    blockfrostUrl: process.env.BLOCKFROST_URL,
    
    // Wallet configuration
    walletMnemonic: process.env.WALLET_MNEMONIC,
    walletAddress: process.env.WALLET_ADDRESS,
    
    // Trading settings
    baseTradeAmount: parseFloat(process.env.BASE_TRADE_AMOUNT) || 5, // ADA
    maxRiskThreshold: parseFloat(process.env.MAX_RISK_THRESHOLD) || 0.3,
    minLiquidityAda: parseFloat(process.env.MIN_LIQUIDITY_ADA) || 1000,
    
    // Safety switches
    testnetMode: process.env.TESTNET_MODE === 'true',
    dryRun: process.env.DRY_RUN === 'true',
    enableLogging: process.env.ENABLE_LOGGING === 'true',
    
    // Scanning settings
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS) || 10000, // 10 seconds
    maxPoolAgeBlocks: parseInt(process.env.MAX_POOL_AGE_BLOCKS) || 5
};

// 🏭 CARDANO DEX CONFIGURATIONS
const CARDANO_DEXES = {
    sundaeswap: {
        name: 'SundaeSwap',
        factoryAddress: 'addr1w9qzpelu9hn45pefc0xr4ac4kdxeswq7pndul2vuj59u8tqaxdznu',
        poolPrefix: '4086577726c65537761705f506f6f6c5f', // HEX for pool identification
        protocolFee: 0.003, // 0.3%
        scriptHashes: [
            '4086577726c65537761705f506f6f6c5f5d5654' // Pool script hash
        ]
    },
    minswap: {
        name: 'Minswap',
        factoryAddress: 'addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70',
        poolPrefix: '6d696e737761705f706f6f6c', // HEX for 'minswap_pool'
        protocolFee: 0.003,
        scriptHashes: [
            'e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86'
        ]
    },
    wingriders: {
        name: 'WingRiders',
        factoryAddress: 'addr1w8nvjzjeydcn4atcd93aac8allvrpjn7jgecyqpqlhkm8ps0yzlls',
        poolPrefix: '77696e6772696465727320706f6f6c', // HEX for 'wingriders pool'
        protocolFee: 0.0035, // 0.35%
        scriptHashes: [
            '026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a570'
        ]
    },
    muesliswap: {
        name: 'MuesliSwap',
        factoryAddress: 'addr1q9x7sz7qkjrlq4zduhn8r9y9m4nwh0z0u3f7n8u8s4u8c8h8gkfg5',
        poolPrefix: '6d7565736c69737761705f706f6f6c', // HEX for 'muesliswap_pool'
        protocolFee: 0.003,
        scriptHashes: [
            'b7b0b0d2b7b0b0d2b7b0b0d2b7b0b0d2b7b0b0d2'
        ]
    }
};

// 📊 STATISTICS TRACKING
let stats = {
    poolsScanned: 0,
    poolsDetected: 0,
    scamsFiltered: 0,
    tradesExecuted: 0,
    totalVolume: 0,
    startTime: new Date(),
    lastPoolCheck: null
};

// 🦅 MAIN CARDANO HAWK CLASS
class CardanoHawk {
    constructor() {
        this.blockfrost = null;
        this.isRunning = false;
        this.knownPools = new Set(); // Track pools we've already seen
        this.scamDatabase = new Map(); // Cache scam analysis
        this.lastBlockHeight = 0;
        
        console.log('🦅 Cardano HAWK Bot Initializing...');
        console.log(`💰 Trade Amount: ${config.baseTradeAmount} ADA`);
        console.log(`🛡️ Safety Mode: ${config.dryRun ? 'ON (Simulation)' : 'OFF (Live Trading)'}`);
        console.log(`🌐 Network: ${config.testnetMode ? 'Testnet' : 'Mainnet'}`);
    }

    // 🚀 INITIALIZE BLOCKFROST CONNECTION
    async initialize() {
        try {
            console.log('\n🔌 Connecting to Cardano via Blockfrost...');
            
            if (!config.blockfrostProjectId || config.blockfrostProjectId === 'your_blockfrost_project_id_here') {
                throw new Error('Blockfrost Project ID not configured! Get one from blockfrost.io');
            }

            this.blockfrost = new BlockFrostAPI({
                projectId: config.blockfrostProjectId,
                isTestnet: config.testnetMode
            });

            // Test connection
            const networkInfo = await this.blockfrost.network();
            console.log(`✅ Connected to Cardano ${config.testnetMode ? 'Testnet' : 'Mainnet'}`);
            console.log(`📊 Current epoch: ${networkInfo.epoch}`);
            
            const latestBlock = await this.blockfrost.blocksLatest();
            this.lastBlockHeight = latestBlock.height;
            console.log(`🧱 Latest block: ${this.lastBlockHeight}`);
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Blockfrost:', error.message);
            return false;
        }
    }

    // 🎯 START POOL SCANNING
    async startHawkEyes() {
        if (!await this.initialize()) {
            return false;
        }

        console.log('\n👀 Starting pool detection across all DEXes...');
        console.log(`🔍 Scanning every ${config.scanIntervalMs / 1000} seconds`);
        console.log('🎯 Target DEXes:', Object.keys(CARDANO_DEXES).join(', '));
        
        this.isRunning = true;
        
        // Start the main scanning loop
        this.scanLoop();
        
        // Display stats every 60 seconds
        setInterval(() => this.displayStats(), 60000);
        
        console.log('\n🟢 HAWK is now HUNTING for pools!\n');
        return true;
    }

    // 🔄 MAIN SCANNING LOOP
    async scanLoop() {
        while (this.isRunning) {
            try {
                await this.scanForNewPools();
                stats.poolsScanned++;
                
                // Wait before next scan
                await this.sleep(config.scanIntervalMs);
                
            } catch (error) {
                console.error('❌ Error in scan loop:', error.message);
                await this.sleep(5000); // Wait 5s before retrying
            }
        }
    }

    // 🔍 SCAN FOR NEW POOLS ACROSS ALL DEXES
    async scanForNewPools() {
        const currentBlock = await this.blockfrost.blocksLatest();
        const newBlockHeight = currentBlock.height;
        
        // Only scan if we have new blocks
        if (newBlockHeight <= this.lastBlockHeight) {
            return;
        }

        console.log(`🔍 Scanning blocks ${this.lastBlockHeight + 1} to ${newBlockHeight}...`);
        
        // Scan recent blocks for pool creation transactions
        for (let blockHeight = this.lastBlockHeight + 1; blockHeight <= newBlockHeight; blockHeight++) {
            await this.scanBlock(blockHeight);
        }
        
        this.lastBlockHeight = newBlockHeight;
        stats.lastPoolCheck = new Date();
    }

    // 🧱 SCAN A SPECIFIC BLOCK FOR POOL ACTIVITIES
    async scanBlock(blockHeight) {
        try {
            const block = await this.blockfrost.blocks(blockHeight.toString());
            const transactions = await this.blockfrost.blocksTxs(blockHeight.toString());
            
            for (const txHash of transactions) {
                await this.analyzeTransaction(txHash, blockHeight);
            }
            
        } catch (error) {
            if (config.enableLogging) {
                console.log(`⚠️ Could not scan block ${blockHeight}: ${error.message}`);
            }
        }
    }

    // 🔬 ANALYZE TRANSACTION FOR POOL CREATION
    async analyzeTransaction(txHash, blockHeight) {
        try {
            const tx = await this.blockfrost.txs(txHash);
            const utxos = await this.blockfrost.txsUtxos(txHash);
            
            // Check if this transaction creates a new pool
            const poolCreation = await this.detectPoolCreation(tx, utxos, blockHeight);
            
            if (poolCreation) {
                console.log(`\n⚡ NEW POOL DETECTED!`);
                console.log(`📍 Transaction: ${txHash}`);
                console.log(`🏭 DEX: ${poolCreation.dex}`);
                console.log(`🪙 Token A: ${poolCreation.tokenA.name || 'Unknown'} (${poolCreation.tokenA.amount} units)`);
                console.log(`🪙 Token B: ${poolCreation.tokenB.name || 'Unknown'} (${poolCreation.tokenB.amount} units)`);
                console.log(`💧 Liquidity: ${poolCreation.liquidityAda} ADA`);
                
                stats.poolsDetected++;
                await this.analyzePoolSafety(poolCreation);
            }
            
        } catch (error) {
            // Most transactions won't be pool-related, so we ignore errors quietly
            if (config.enableLogging && error.message.includes('pool')) {
                console.log(`⚠️ Error analyzing tx ${txHash}: ${error.message}`);
            }
        }
    }

    // 🎯 DETECT POOL CREATION IN TRANSACTION
    async detectPoolCreation(tx, utxos, blockHeight) {
        // Check each DEX for pool creation patterns
        for (const [dexName, dexConfig] of Object.entries(CARDANO_DEXES)) {
            const poolData = await this.checkDexPoolCreation(tx, utxos, dexName, dexConfig, blockHeight);
            if (poolData) {
                return poolData;
            }
        }
        
        return null;
    }

    // 🏭 CHECK SPECIFIC DEX FOR POOL CREATION
    async checkDexPoolCreation(tx, utxos, dexName, dexConfig, blockHeight) {
        // Look for outputs going to DEX factory address
        const dexOutputs = utxos.outputs.filter(output => 
            output.address === dexConfig.factoryAddress ||
            dexConfig.scriptHashes.some(hash => output.address.includes(hash))
        );

        if (dexOutputs.length === 0) {
            return null;
        }

        // Analyze the UTxOs to extract pool information
        let tokenA = null, tokenB = null, liquidityAda = 0;

        for (const output of dexOutputs) {
            // Calculate ADA liquidity
            liquidityAda += parseFloat(output.amount[0].quantity) / 1000000; // Convert lovelace to ADA

            // Extract native tokens
            if (output.amount.length > 1) {
                for (let i = 1; i < output.amount.length; i++) {
                    const token = output.amount[i];
                    const tokenInfo = await this.getTokenInfo(token.unit);
                    
                    if (!tokenA) {
                        tokenA = { ...tokenInfo, amount: token.quantity };
                    } else if (!tokenB) {
                        tokenB = { ...tokenInfo, amount: token.quantity };
                    }
                }
            }
        }

        // Must have minimum liquidity and two tokens
        if (liquidityAda < config.minLiquidityAda || !tokenA || !tokenB) {
            return null;
        }

        // Create unique pool ID to avoid duplicates
        const poolId = `${dexName}_${tokenA.policyId}_${tokenB.policyId}`;
        if (this.knownPools.has(poolId)) {
            return null; // Already processed this pool
        }

        this.knownPools.add(poolId);

        return {
            poolId,
            dex: dexName,
            dexConfig,
            txHash: tx.hash,
            blockHeight,
            tokenA,
            tokenB,
            liquidityAda,
            createdAt: new Date(),
            poolAddress: dexOutputs[0].address
        };
    }

    // 🪙 GET TOKEN INFORMATION
    async getTokenInfo(assetId) {
        try {
            if (assetId === 'lovelace') {
                return {
                    name: 'ADA',
                    ticker: 'ADA',
                    policyId: 'ada',
                    decimals: 6,
                    isNative: true
                };
            }

            const asset = await this.blockfrost.assets(assetId);
            const metadata = asset.metadata;

            return {
                name: metadata?.name || 'Unknown Token',
                ticker: metadata?.ticker || asset.asset_name,
                policyId: asset.policy_id,
                assetName: asset.asset_name,
                decimals: metadata?.decimals || 0,
                isNative: false,
                totalSupply: asset.quantity,
                mintingTxs: asset.mint_or_burn_count
            };
        } catch (error) {
            return {
                name: 'Unknown Token',
                ticker: 'UNK',
                policyId: assetId.substring(0, 56),
                assetName: assetId.substring(56),
                decimals: 0,
                isNative: false
            };
        }
    }

    // 🧠 ANALYZE POOL SAFETY (Cardano-specific scam detection)
    async analyzePoolSafety(poolData) {
        console.log('\n🔍 Analyzing pool safety...');
        
        const analysis = {
            riskScore: 0,
            reasons: [],
            recommendation: 'UNKNOWN',
            checks: {}
        };

        try {
            // STEP 1: Check token policies and minting history
            analysis.checks.tokenPolicyCheck = await this.analyzeTokenPolicies(poolData);
            analysis.riskScore += analysis.checks.tokenPolicyCheck.risk;
            analysis.reasons.push(...analysis.checks.tokenPolicyCheck.reasons);

            // STEP 2: Check liquidity legitimacy  
            analysis.checks.liquidityCheck = await this.analyzeLiquidity(poolData);
            analysis.riskScore += analysis.checks.liquidityCheck.risk;
            analysis.reasons.push(...analysis.checks.liquidityCheck.reasons);

            // STEP 3: Check minting patterns for scams
            analysis.checks.mintingCheck = await this.analyzeMintingPatterns(poolData);
            analysis.riskScore += analysis.checks.mintingCheck.risk;
            analysis.reasons.push(...analysis.checks.mintingCheck.reasons);

            // STEP 4: Check metadata and naming
            analysis.checks.metadataCheck = await this.analyzeMetadata(poolData);
            analysis.riskScore += analysis.checks.metadataCheck.risk;
            analysis.reasons.push(...analysis.checks.metadataCheck.reasons);

            // STEP 5: Final decision
            if (analysis.riskScore <= config.maxRiskThreshold) {
                analysis.recommendation = 'SAFE_TO_TRADE';
                console.log('✅ Pool looks SAFE for trading!');
                
                if (!config.dryRun) {
                    await this.executeCardanoTrade(poolData, analysis);
                } else {
                    console.log('🎭 DRY RUN: Would execute trade here');
                    stats.tradesExecuted++;
                }
            } else {
                analysis.recommendation = 'TOO_RISKY';
                console.log(`❌ Pool too risky (Risk Score: ${analysis.riskScore.toFixed(2)})`);
                stats.scamsFiltered++;
            }

            // Display detailed analysis
            console.log('\n📊 SAFETY ANALYSIS RESULTS:');
            analysis.reasons.forEach(reason => console.log(`   ${reason}`));
            console.log(`📈 Risk Score: ${analysis.riskScore.toFixed(2)} / 1.0`);
            console.log(`💡 Recommendation: ${analysis.recommendation}\n`);

        } catch (error) {
            console.error('❌ Error during safety analysis:', error.message);
            analysis.recommendation = 'ERROR_ANALYSIS_FAILED';
        }

        return analysis;
    }

    // 🔒 ANALYZE TOKEN POLICIES (Cardano-specific)
    async analyzeTokenPolicies(poolData) {
        const check = { risk: 0, reasons: [] };

        try {
            // Check if tokens have proper policies
            for (const token of [poolData.tokenA, poolData.tokenB]) {
                if (token.isNative) continue; // Skip ADA

                // Get policy details
                const policy = await this.blockfrost.scriptsByHash(token.policyId);
                
                if (policy.type === 'timelock') {
                    check.reasons.push(`✅ ${token.name} has timelock policy (safer)`);
                } else if (policy.type === 'plutus') {
                    check.risk += 0.1;
                    check.reasons.push(`⚠️ ${token.name} uses Plutus script (check carefully)`);
                }

                // Check minting history
                if (token.mintingTxs > 100) {
                    check.risk += 0.2;
                    check.reasons.push(`⚠️ ${token.name} has many minting transactions (${token.mintingTxs})`);
                }
            }

        } catch (error) {
            check.risk += 0.15;
            check.reasons.push('⚠️ Could not verify token policies');
        }

        return check;
    }

    // 💧 ANALYZE LIQUIDITY PATTERNS
    async analyzeLiquidity(poolData) {
        const check = { risk: 0, reasons: [] };

        // Check liquidity amount
        if (poolData.liquidityAda < 1000) {
            check.risk += 0.3;
            check.reasons.push(`⚠️ Low liquidity: ${poolData.liquidityAda} ADA`);
        } else if (poolData.liquidityAda > 10000) {
            check.reasons.push(`✅ Good liquidity: ${poolData.liquidityAda} ADA`);
        } else {
            check.reasons.push(`ℹ️ Moderate liquidity: ${poolData.liquidityAda} ADA`);
        }

        // Check token ratio (extreme ratios are suspicious)
        const ratioA = parseFloat(poolData.tokenA.amount);
        const ratioB = parseFloat(poolData.tokenB.amount);
        const ratio = Math.max(ratioA, ratioB) / Math.min(ratioA, ratioB);

        if (ratio > 1000000) {
            check.risk += 0.4;
            check.reasons.push('⚠️ Extreme token ratio detected (possible scam)');
        } else if (ratio > 10000) {
            check.risk += 0.2;
            check.reasons.push('⚠️ High token ratio (check carefully)');
        } else {
            check.reasons.push('✅ Token ratio looks normal');
        }

        return check;
    }

    // 🪙 ANALYZE MINTING PATTERNS
    async analyzeMintingPatterns(poolData) {
        const check = { risk: 0, reasons: [] };

        try {
            for (const token of [poolData.tokenA, poolData.tokenB]) {
                if (token.isNative) continue;

                // Check when token was first minted
                const mintingTxs = await this.blockfrost.assetsHistory(token.policyId + token.assetName);
                
                if (mintingTxs.length > 0) {
                    const firstMint = mintingTxs[0];
                    const mintBlock = await this.blockfrost.txs(firstMint.tx_hash);
                    const blocksSinceMint = poolData.blockHeight - mintBlock.block_height;
                    
                    if (blocksSinceMint < 10) {
                        check.risk += 0.3;
                        check.reasons.push(`⚠️ ${token.name} was minted very recently (${blocksSinceMint} blocks ago)`);
                    } else {
                        check.reasons.push(`✅ ${token.name} has been around for ${blocksSinceMint} blocks`);
                    }
                }
            }

        } catch (error) {
            check.risk += 0.1;
            check.reasons.push('⚠️ Could not verify minting history');
        }

        return check;
    }

    // 📝 ANALYZE METADATA
    async analyzeMetadata(poolData) {
        const check = { risk: 0, reasons: [] };

        const suspiciousWords = ['test', 'fake', 'scam', 'rug', 'honeypot', 'moon', 'safe', 'baby'];
        
        for (const token of [poolData.tokenA, poolData.tokenB]) {
            if (token.isNative) continue;

            const tokenName = token.name.toLowerCase();
            
            // Check for suspicious words
            const hasSuspiciousWord = suspiciousWords.some(word => tokenName.includes(word));
            if (hasSuspiciousWord) {
                check.risk += 0.25;
                check.reasons.push(`⚠️ ${token.name} has suspicious name pattern`);
            }

            // Check for proper metadata
            if (!token.name || token.name === 'Unknown Token') {
                check.risk += 0.15;
                check.reasons.push(`⚠️ ${token.ticker} has no proper metadata`);
            } else {
                check.reasons.push(`✅ ${token.name} has proper metadata`);
            }
        }

        return check;
    }

    // 💰 EXECUTE CARDANO TRADE
    async executeCardanoTrade(poolData, analysis) {
        console.log('💰 EXECUTING CARDANO TRADE...');
        
        try {
            // For now, just simulate the trade
            console.log(`📝 Would swap ${config.baseTradeAmount} ADA for ${poolData.tokenA.name}`);
            console.log(`🏭 DEX: ${poolData.dex}`);
            console.log(`🎯 Pool: ${poolData.poolAddress}`);
            console.log(`💡 Risk Score: ${analysis.riskScore.toFixed(2)}`);
            
            stats.tradesExecuted++;
            stats.totalVolume += config.baseTradeAmount;
            
            // TODO: Implement actual Cardano transaction building
            // This would involve:
            // 1. Building transaction with cardano-serialization-lib
            // 2. Signing with wallet keys
            // 3. Submitting to DEX smart contract
            
            console.log('✅ Trade executed successfully (simulated)');
            
        } catch (error) {
            console.error('❌ Trade execution failed:', error.message);
        }
    }

    // 📊 DISPLAY STATISTICS
    displayStats() {
        const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        console.log('\n📊 CARDANO HAWK STATISTICS');
        console.log('============================');
        console.log(`⏱️ Uptime: ${hours}h ${minutes}m`);
        console.log(`🔍 Blocks Scanned: ${stats.poolsScanned}`);
        console.log(`⚡ Pools Detected: ${stats.poolsDetected}`);
        console.log(`🛡️ Scams Filtered: ${stats.scamsFiltered}`);
        console.log(`💰 Trades Executed: ${stats.tradesExecuted}`);
        console.log(`📈 Total Volume: ${stats.totalVolume} ADA`);
        console.log(`📅 Last Check: ${stats.lastPoolCheck ? stats.lastPoolCheck.toLocaleTimeString() : 'Never'}`);
        console.log('============================\n');
    }

    // 💤 SLEEP UTILITY
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 🛑 STOP THE BOT
    stop() {
        console.log('🛑 Stopping Cardano HAWK...');
        this.isRunning = false;
        console.log('✅ Bot stopped successfully');
    }
}

// 🚀 MAIN EXECUTION
async function main() {
    console.log('🦅 CARDANO HAWK - Pool Detection Bot v1.0');
    console.log('============================================');
    
    // Validate configuration
    if (!config.blockfrostProjectId || config.blockfrostProjectId === 'your_blockfrost_project_id_here') {
        console.error('❌ Blockfrost Project ID not configured!');
        console.log('📝 Get a free API key from https://blockfrost.io');
        console.log('📝 Add it to your .env file as BLOCKFROST_PROJECT_ID');
        process.exit(1);
    }

    // Create and start the bot
    const hawk = new CardanoHawk();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Received shutdown signal...');
        hawk.stop();
        process.exit(0);
    });

    // Start hunting
    const success = await hawk.startHawkEyes();
    if (!success) {
        console.error('💀 Failed to start HAWK bot');
        process.exit(1);
    }
}

// Export for testing
module.exports = { CardanoHawk };

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('💀 Fatal error:', error.message);
        process.exit(1);
    });
}