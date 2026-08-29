'use strict';
const crypto = require('crypto');
const {
  AccountRole, address, appendTransactionMessageInstruction, compileTransactionMessage,
  createKeyPairSignerFromBytes, createSolanaRpc, createSolanaRpcSubscriptions,
  createTransactionMessage, getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder, getSignatureFromTransaction, isAddress,
  mainnet, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} = require('@solana/kit');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
let configuredRpcUrls=[];let rpcCursor=0;
function setRpcUrls(urls){configuredRpcUrls=[...new Set((urls||[]).map(x=>String(x).trim()).filter(Boolean))].slice(0,10);rpcCursor=0;}
function nextRpc(){const urls=configuredRpcUrls.length?configuredRpcUrls:[process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com'];const url=urls[rpcCursor++%urls.length];return createSolanaRpc(mainnet(url));}
function transactionRpc(){return createSolanaRpc(mainnet(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com'));}
const previews = new Map();
const toSafeNumber = (value) => { const n=Number(value); if(!Number.isSafeInteger(n)) throw Error('amount exceeds safe range'); return n; };
function instruction(signer,destination,amount){const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(amount,4);return{programAddress:SYSTEM_PROGRAM,accounts:[{address:signer.address,role:AccountRole.WRITABLE_SIGNER,signer},{address:destination,role:AccountRole.WRITABLE}],data};}
async function balances(wallets){return Promise.all(wallets.map(async w=>{try{const r=await nextRpc().getBalance(address(w.public_key),{commitment:'confirmed'}).send();return{...w,balanceLamports:String(r.value),balanceSol:Number(r.value)/1e9};}catch{return{...w,balanceLamports:null,balanceSol:null};}}));}
async function preview({secretKey,sourceId,sourceLabel,destination,amountSol,owner}){
  const rpc=transactionRpc();
  if(!isAddress(destination)) throw Object.assign(Error('invalid Solana destination'),{status:400});
  const amountNumber=Number(amountSol);if(!Number.isFinite(amountNumber)||amountNumber<=0||amountNumber>1000000)throw Object.assign(Error('invalid SOL amount'),{status:400});
  const amount=BigInt(Math.round(amountNumber*1e9));if(amount<=0n)throw Object.assign(Error('amount below one lamport'),{status:400});
  const signer=await createKeyPairSignerFromBytes(new Uint8Array(secretKey));const destinationAddress=address(destination);
  if(signer.address===destinationAddress)throw Object.assign(Error('source and destination must differ'),{status:400});
  const [balanceResponse,blockhashResponse]=await Promise.all([rpc.getBalance(signer.address,{commitment:'confirmed'}).send(),rpc.getLatestBlockhash({commitment:'confirmed'}).send()]);
  const message=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(signer,m),m=>setTransactionMessageLifetimeUsingBlockhash(blockhashResponse.value,m),m=>appendTransactionMessageInstruction(instruction(signer,destinationAddress,amount),m));
  const compiled=compileTransactionMessage(message);const encoded=getCompiledTransactionMessageEncoder().encode(compiled);const fee=(await rpc.getFeeForMessage(Buffer.from(encoded).toString('base64'),{commitment:'confirmed'}).send()).value;
  if(fee===null||balanceResponse.value<amount+fee)throw Object.assign(Error('insufficient balance for amount and fee'),{status:409});
  const signed=await signTransactionMessageWithSigners(message);const wire=getBase64EncodedWireTransaction(signed);const simulation=(await rpc.simulateTransaction(wire,{encoding:'base64',commitment:'confirmed',sigVerify:true}).send()).value;
  if(simulation.err!==null)throw Object.assign(Error('transaction simulation failed'),{status:409});
  const token=crypto.randomBytes(32).toString('base64url');const expiresAt=Date.now()+90000;previews.set(token,{signed,expiresAt,owner,sourceId,destination:String(destinationAddress),amountLamports:String(amount),feeLamports:String(fee)});setTimeout(()=>previews.delete(token),91000).unref();
  return{previewToken:token,expiresAt:new Date(expiresAt).toISOString(),sourceId,sourceLabel,sourceAddress:String(signer.address),destination:String(destinationAddress),amountLamports:String(amount),amountSol:amountNumber,feeLamports:String(fee),feeSol:toSafeNumber(fee)/1e9,balanceAfterSol:toSafeNumber(balanceResponse.value-amount-fee)/1e9,signature:String(getSignatureFromTransaction(signed))};
}
async function confirm(token,owner){const item=previews.get(token);previews.delete(token);if(!item||item.owner!==owner||item.expiresAt<Date.now())throw Object.assign(Error('preview expired or already used'),{status:409});const signature=String(getSignatureFromTransaction(item.signed));const rpc=transactionRpc();const rpcSubscriptions=createSolanaRpcSubscriptions(mainnet(process.env.SOLANA_WS_URL||'wss://api.mainnet-beta.solana.com'));await sendAndConfirmTransactionFactory({rpc,rpcSubscriptions})(item.signed,{commitment:'confirmed',preflightCommitment:'confirmed',skipPreflight:false});return{signature,sourceId:item.sourceId,destination:item.destination,amountLamports:item.amountLamports,feeLamports:item.feeLamports,explorerUrl:`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`};}

/**
 * Sweep entire SOL balance (minus fee) from source to destination.
 * Uses pre-decrypted secret key from session unlock — no password re-prompt.
 * Returns the broadcast result or throws on failure.
 */
async function sweep({secretKey,sourceId,sourceLabel,destination,owner}){
  const rpc=transactionRpc();
  if(!isAddress(destination))throw Object.assign(Error('invalid Solana destination'),{status:400});
  const signer=await createKeyPairSignerFromBytes(new Uint8Array(secretKey));const destinationAddress=address(destination);
  if(signer.address===destinationAddress)throw Object.assign(Error('source and destination must differ'),{status:400});
  const [balanceResponse,blockhashResponse]=await Promise.all([rpc.getBalance(signer.address,{commitment:'confirmed'}).send(),rpc.getLatestBlockhash({commitment:'confirmed'}).send()]);
  // Build a dummy tx to estimate fee, then sweep balance - fee
  const msg0=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(signer,m),m=>setTransactionMessageLifetimeUsingBlockhash(blockhashResponse.value,m),m=>appendTransactionMessageInstruction(instruction(signer,destinationAddress,1n),m));
  const compiled0=compileTransactionMessage(msg0);const encoded0=getCompiledTransactionMessageEncoder().encode(compiled0);const fee=(await rpc.getFeeForMessage(Buffer.from(encoded0).toString('base64'),{commitment:'confirmed'}).send()).value;
  if(fee===null)throw Object.assign(Error('cannot estimate fee'),{status:502});
  const balance=BigInt(balanceResponse.value);
  if(balance<=BigInt(fee))throw Object.assign(Error('balance too low to sweep after fee'),{status:409});
  const amount=balance-BigInt(fee);
  const message=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(signer,m),m=>setTransactionMessageLifetimeUsingBlockhash(blockhashResponse.value,m),m=>appendTransactionMessageInstruction(instruction(signer,destinationAddress,amount),m));
  const compiled=compileTransactionMessage(message);const encoded=getCompiledTransactionMessageEncoder().encode(compiled);const realFee=(await rpc.getFeeForMessage(Buffer.from(encoded).toString('base64'),{commitment:'confirmed'}).send()).value;
  // Recalculate with real fee (may differ from dummy)
  let finalAmount=amount;let finalFee=fee;
  if(realFee!==null&&BigInt(realFee)!==BigInt(fee)){finalFee=realFee;if(balance<=BigInt(finalFee))throw Object.assign(Error('balance too low to sweep after fee'),{status:409});finalAmount=balance-BigInt(finalFee);}
  // Rebuild with correct amount if fee changed
  let signed;
  if(finalAmount!==amount){
    const msg=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(signer,m),m=>setTransactionMessageLifetimeUsingBlockhash(blockhashResponse.value,m),m=>appendTransactionMessageInstruction(instruction(signer,destinationAddress,finalAmount),m));
    signed=await signTransactionMessageWithSigners(msg);
  }else{
    signed=await signTransactionMessageWithSigners(message);
  }
  const wire=getBase64EncodedWireTransaction(signed);const simulation=(await rpc.simulateTransaction(wire,{encoding:'base64',commitment:'confirmed',sigVerify:true}).send()).value;
  if(simulation.err!==null)throw Object.assign(Error('transaction simulation failed'),{status:409});
  const signature=String(getSignatureFromTransaction(signed));
  const rpcSubscriptions=createSolanaRpcSubscriptions(mainnet(process.env.SOLANA_WS_URL||'wss://api.mainnet-beta.solana.com'));
  await sendAndConfirmTransactionFactory({rpc,rpcSubscriptions})(signed,{commitment:'confirmed',preflightCommitment:'confirmed',skipPreflight:false});
  return{signature,sourceId,destination:String(destinationAddress),amountLamports:String(finalAmount),feeLamports:String(finalFee),balanceBeforeLamports:String(balance),explorerUrl:`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`};
}
module.exports={balances,preview,confirm,sweep,setRpcUrls};
