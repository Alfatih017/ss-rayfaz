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
const rpc = createSolanaRpc(mainnet(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'));
const previews = new Map();
const toSafeNumber = (value) => { const n=Number(value); if(!Number.isSafeInteger(n)) throw Error('amount exceeds safe range'); return n; };
function instruction(signer,destination,amount){const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(amount,4);return{programAddress:SYSTEM_PROGRAM,accounts:[{address:signer.address,role:AccountRole.WRITABLE_SIGNER,signer},{address:destination,role:AccountRole.WRITABLE}],data};}
async function balances(wallets){return Promise.all(wallets.map(async w=>{try{const r=await rpc.getBalance(address(w.public_key),{commitment:'confirmed'}).send();return{...w,balanceLamports:String(r.value),balanceSol:Number(r.value)/1e9};}catch{return{...w,balanceLamports:null,balanceSol:null};}}));}
async function preview({secretKey,sourceId,sourceLabel,destination,amountSol,owner}){
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
async function confirm(token,owner){const item=previews.get(token);previews.delete(token);if(!item||item.owner!==owner||item.expiresAt<Date.now())throw Object.assign(Error('preview expired or already used'),{status:409});const signature=String(getSignatureFromTransaction(item.signed));const rpcSubscriptions=createSolanaRpcSubscriptions(mainnet(process.env.SOLANA_WS_URL||'wss://api.mainnet-beta.solana.com'));await sendAndConfirmTransactionFactory({rpc,rpcSubscriptions})(item.signed,{commitment:'confirmed',preflightCommitment:'confirmed',skipPreflight:false});return{signature,sourceId:item.sourceId,destination:item.destination,amountLamports:item.amountLamports,feeLamports:item.feeLamports,explorerUrl:`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`};}
module.exports={balances,preview,confirm};
