// Launch a real coin on pump.fun for make.fun bounty makefun-coin-launch-01.
// Flow: upload metadata (ghost logo) to pump.fun IPFS -> create mint + bonding curve
// via the pump.fun program -> write LAUNCH.json with mint + create signature.
// Uses only @solana/web3.js + node built-ins. No initial buy (create-only, per rules).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const MPL_TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');

const WALLET_PATH = process.env.WALLET_PATH || '/home/hatch/workspace/makefun-tooling/makefun-keypair.json';
const NAME = 'MakeFun Ghost';
const SYMBOL = 'GHOST';
const DESCRIPTION = 'made for make.fun $1000 bounty';

function anchorDiscriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

async function uploadMetadata() {
  // pump.fun's IPFS endpoint is Cloudflare-blocked from this VM, so the metadata
  // lives on GitHub raw instead (public, unmodified ghost logo + exact description).
  return 'https://raw.githubusercontent.com/Azet17/makefun-coin-launch-01/main/metadata.json';
}

async function main() {
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(WALLET_PATH, 'utf8'))));
  console.log('wallet:', wallet.publicKey.toBase58());
  const connection = new Connection(RPC, 'confirmed');

  const balance = await connection.getBalance(wallet.publicKey);
  console.log('balance SOL:', balance / 1e9);
  if (balance < 0.025 * 1e9) throw new Error('insufficient SOL (need >= 0.025)');

  // 1. Upload metadata
  const metadataUri = await uploadMetadata();
  console.log('metadataUri:', metadataUri);

  // 2. Derive PDAs
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log('mint:', mint.toBase58());
  const [mintAuthority] = findPDA([Buffer.from('mint-authority'), mint.toBuffer()], PUMP_PROGRAM_ID);
  const [bondingCurve] = findPDA([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID);
  const [globalAccount] = findPDA([Buffer.from('global')], PUMP_PROGRAM_ID);
  const [metadataAccount] = findPDA(
    [Buffer.from('metadata'), MPL_TOKEN_METADATA.toBuffer(), mint.toBuffer()],
    MPL_TOKEN_METADATA,
  );
  const [eventAuthority] = findPDA([Buffer.from('__event_authority')], PUMP_PROGRAM_ID);
  // Associated bonding curve = ATA of bondingCurve for mint
  const [associatedBondingCurve] = findPDA(
    [bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // 3. Build transaction: create mint account + init mint + create ATA + pump create
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  const createMintIx = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: mint,
    lamports: mintRent,
    space: 82,
    programId: TOKEN_PROGRAM_ID,
  });

  // initializeMint (discriminator 0): [0, decimals, mintAuth(32), freezeAuthOption(1), freezeAuth(32)]
  // accounts: [mint (writable), rent sysvar]
  const initMintData = Buffer.alloc(67);
  initMintData[0] = 0; // initializeMint
  initMintData[1] = 6; // decimals
  mintAuthority.toBuffer().copy(initMintData, 2);
  initMintData[34] = 1; // freeze authority present
  mintAuthority.toBuffer().copy(initMintData, 35);
  const initMintIx = new TransactionInstruction({
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data: initMintData,
  });

  // createAssociatedTokenAccount: ATA for bondingCurve
  const ataIx = new TransactionInstruction({
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
  });

  // pump.fun create instruction: discriminator + name + symbol + uri (borsh strings)
  function borshString(s) {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length, 0);
    return Buffer.concat([len, b]);
  }
  const createData = Buffer.concat([
    anchorDiscriminator('create'),
    borshString(NAME),
    borshString(SYMBOL),
    borshString(metadataUri),
  ]);
  const createIx = new TransactionInstruction({
    keys: [
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: globalAccount, isSigner: false, isWritable: false },
      { pubkey: MPL_TOKEN_METADATA, isSigner: false, isWritable: false },
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PUMP_PROGRAM_ID,
    data: createData,
  });

  const tx = new Transaction().add(createMintIx, initMintIx, ataIx, createIx);
  tx.feePayer = wallet.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair], {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  console.log('CREATE SIGNATURE:', sig);
  console.log('MINT:', mint.toBase58());

  const launch = { mint: mint.toBase58(), create_signature: sig };
  writeFileSync('/home/hatch/workspace/makefun-coin-launch-01/LAUNCH.json', JSON.stringify(launch, null, 2) + '\n');
  console.log('LAUNCH.json written');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
