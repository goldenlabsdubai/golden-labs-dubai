/**
 * User service: uses PostgreSQL when configured (PGHOST, PGDATABASE, PGUSER),
 * otherwise falls back to Firestore. Platform should run with PG in production.
 */
import { getPool } from "../config/postgres.js";
import * as UserPg from "./userPostgres.js";
import * as UserFs from "./userFirestore.js";

function usePg() {
  return Boolean(getPool());
}

export async function getUserByWallet(wallet) {
  return usePg() ? UserPg.getUserByWallet(wallet) : UserFs.getUserByWallet(wallet);
}
export async function getUserByFirebaseUid(uid) {
  return usePg() ? UserPg.getUserByFirebaseUid(uid) : UserFs.getUserByFirebaseUid(uid);
}
export async function createUser(data) {
  return usePg() ? UserPg.createUser(data) : UserFs.createUser(data);
}
export async function updateUser(docId, data) {
  return usePg() ? UserPg.updateUser(docId, data) : UserFs.updateUser(docId, data);
}
export async function findUserByUsername(username) {
  return usePg() ? UserPg.findUserByUsername(username) : UserFs.findUserByUsername(username);
}
export async function getUser(req) {
  return usePg() ? UserPg.getUser(req) : UserFs.getUser(req);
}
export function getDocId(req) {
  return usePg() ? UserPg.getDocId(req) : UserFs.getDocId(req);
}
export async function getTopSellers(limit) {
  return usePg() ? UserPg.getTopSellers(limit) : UserFs.getTopSellers(limit);
}
export async function incrementUserTrades(wallet) {
  return usePg() ? UserPg.incrementUserTrades(wallet) : UserFs.incrementUserTrades(wallet);
}
export async function incrementReferralChain(referrerWallet) {
  return usePg() ? UserPg.incrementReferralChain(referrerWallet) : UserFs.incrementReferralChain(referrerWallet);
}
export async function addReferralEarning(referrerWallet, level, amount) {
  return usePg() ? UserPg.addReferralEarning(referrerWallet, level, amount) : UserFs.addReferralEarning(referrerWallet, level, amount);
}
export async function setReferralEarningsTotalAtLeast(wallet, amount) {
  return usePg() ? UserPg.setReferralEarningsTotalAtLeast(wallet, amount) : UserFs.setReferralEarningsTotalAtLeast(wallet, amount);
}
export async function setReferralEarningsL1AtLeast(wallet, amount) {
  return usePg() ? UserPg.setReferralEarningsL1AtLeast(wallet, amount) : UserFs.setReferralEarningsL1AtLeast(wallet, amount);
}
export async function logActivity(wallet, type, data) {
  return usePg() ? UserPg.logActivity(wallet, type, data) : UserFs.logActivity(wallet, type, data);
}
export async function getTradeCountFromActivity(wallet) {
  return usePg() ? UserPg.getTradeCountFromActivity(wallet) : UserFs.getTradeCountFromActivity(wallet);
}
export async function getWalletTradeStatsFromActivity(wallet, maxRows) {
  return usePg() ? UserPg.getWalletTradeStatsFromActivity(wallet, maxRows) : UserFs.getWalletTradeStatsFromActivity(wallet, maxRows);
}
export async function getActivities(wallet, limit, offset) {
  return usePg() ? UserPg.getActivities(wallet, limit, offset) : UserFs.getActivities(wallet, limit, offset);
}
export async function getActivitiesSince(wallet, since, limit) {
  return usePg() ? UserPg.getActivitiesSince(wallet, since, limit) : UserFs.getActivitiesSince(wallet, since, limit);
}
export async function recordPurchase(buyerWallet, sellerWallet, tokenId, price, options) {
  return usePg() ? UserPg.recordPurchase(buyerWallet, sellerWallet, tokenId, price, options) : UserFs.recordPurchase(buyerWallet, sellerWallet, tokenId, price, options);
}
export async function addOwnedTokenId(wallet, tokenId) {
  return usePg() ? UserPg.addOwnedTokenId(wallet, tokenId) : UserFs.addOwnedTokenId(wallet, tokenId);
}
export async function getOwnedTokenIds(wallet) {
  return usePg() ? UserPg.getOwnedTokenIds(wallet) : UserFs.getOwnedTokenIds(wallet);
}
