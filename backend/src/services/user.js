/**
 * User service — PostgreSQL only (AWS RDS). Set PGHOST, PGDATABASE, PGUSER in .env.
 */
import * as UserPg from "./userPostgres.js";

export async function getUserByWallet(wallet) {
  return UserPg.getUserByWallet(wallet);
}
export async function getUserByFirebaseUid(uid) {
  return UserPg.getUserByFirebaseUid(uid);
}
export async function createUser(data) {
  return UserPg.createUser(data);
}
export async function updateUser(docId, data) {
  return UserPg.updateUser(docId, data);
}
export async function findUserByUsername(username) {
  return UserPg.findUserByUsername(username);
}
export async function getUser(req) {
  return UserPg.getUser(req);
}
export function getDocId(req) {
  return UserPg.getDocId(req);
}
export async function getTopSellers(limit) {
  return UserPg.getTopSellers(limit);
}
export async function incrementUserTrades(wallet) {
  return UserPg.incrementUserTrades(wallet);
}
export async function incrementReferralChain(referrerWallet) {
  return UserPg.incrementReferralChain(referrerWallet);
}
export async function addReferralEarning(referrerWallet, level, amount) {
  return UserPg.addReferralEarning(referrerWallet, level, amount);
}
export async function setReferralEarningsTotalAtLeast(wallet, amount) {
  return UserPg.setReferralEarningsTotalAtLeast(wallet, amount);
}
export async function setReferralEarningsL1AtLeast(wallet, amount) {
  return UserPg.setReferralEarningsL1AtLeast(wallet, amount);
}
export async function logActivity(wallet, type, data) {
  return UserPg.logActivity(wallet, type, data);
}
export async function getTradeCountFromActivity(wallet) {
  return UserPg.getTradeCountFromActivity(wallet);
}
export async function getWalletTradeStatsFromActivity(wallet, maxRows) {
  return UserPg.getWalletTradeStatsFromActivity(wallet, maxRows);
}
export async function getActivities(wallet, limit, offset) {
  return UserPg.getActivities(wallet, limit, offset);
}
export async function getActivitiesSince(wallet, since, limit) {
  return UserPg.getActivitiesSince(wallet, since, limit);
}
export async function recordPurchase(buyerWallet, sellerWallet, tokenId, price, options) {
  return UserPg.recordPurchase(buyerWallet, sellerWallet, tokenId, price, options);
}
export async function addOwnedTokenId(wallet, tokenId) {
  return UserPg.addOwnedTokenId(wallet, tokenId);
}
export async function getOwnedTokenIds(wallet) {
  return UserPg.getOwnedTokenIds(wallet);
}
