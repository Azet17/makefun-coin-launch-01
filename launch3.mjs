// Launch MakeFun Ghost on pump.fun using the SDK's getCreateInstructions
// (correct 4-arg create: name, symbol, uri, creator) with GitHub-hosted metadata.
// Sends ONLY the create instruction, as the SDK does — the program creates the mint.
import { readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { PumpFunSDK } from 'pumpdotfun-sdk';

const RPC = 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = '/home/hatch/workspace/makefun-tooling/makefun-keypair.json';
const NAME = 'MakeFun Ghost';
const SYMBOL = 'GHOST';
const METADATA_URI = 'https://raw.githubusercontent.com/Azet17/makefun-coin-launch-01/main/metadata.json';

async function main() {
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(WALLET_PATH, 'utf8'))));
  console.log('wallet:', wallet.publicKey.toBase58());
  const connection = new Connection(RPC, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('balance SOL:', balance / 1e9);
  if (balance < 0.025 * 1e9) throw new Error('insufficient SOL (need >= 0.025)');

  const sdk = new PumpFunSDK(connection);
  const mint = Keypair.generate();
  console.log('mint:', mint.publicKey.toBase58());

  const createIx = await sdk.getCreateInstructions(wallet.publicKey, NAME, SYMBOL, METADATA_URI, mint);
  const tx = new Transaction().add(createIx);
  tx.feePayer = wallet.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet, mint], { commitment: 'confirmed' });
  console.log('CREATE SIGNATURE:', sig);
  console.log('MINT:', mint.publicKey.toBase58());

  const launch = { mint: mint.publicKey.toBase58(), create_signature: sig };
  writeFileSync('/home/hatch/workspace/makefun-coin-launch-01/LAUNCH.json', JSON.stringify(launch, null, 2) + '\n');
  console.log('LAUNCH.json written');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
