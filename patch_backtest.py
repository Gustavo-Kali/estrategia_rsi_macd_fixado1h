import re

with open("js/backtest.js", "r", encoding="utf-8") as f:
    code = f.read()

load_fields = """
                bt.grossPnl = obj.grossPnl || 0;
                bt.netPnl = obj.netPnl || 0;
                bt.peakBalance = obj.peakBalance || obj.initialBalance || 10000;
                bt.feesPaid = obj.feesPaid || 0;
                bt.maxDrawdown = obj.maxDrawdown || 0;
                bt.maxDrawdownPct = obj.maxDrawdownPct || 0;
                bt.maxWin = obj.maxWin || 0;
                bt.maxLoss = obj.maxLoss || 0;
                bt.grossWinsTotal = obj.grossWinsTotal || 0;
                bt.grossLossesTotal = obj.grossLossesTotal || 0;
                bt.consecutiveWins = obj.consecutiveWins || 0;
                bt.maxConsecutiveWins = obj.maxConsecutiveWins || 0;
                bt.consecutiveLosses = obj.consecutiveLosses || 0;
                bt.maxConsecutiveLosses = obj.maxConsecutiveLosses || 0;
                bt.longTrades = obj.longTrades || 0;
                bt.longWins = obj.longWins || 0;
                bt.longLosses = obj.longLosses || 0;
                bt.shortTrades = obj.shortTrades || 0;
                bt.shortWins = obj.shortWins || 0;
                bt.shortLosses = obj.shortLosses || 0;
                bt.tradeHistory = obj.tradeHistory || [];
"""

save_fields = """
        grossPnl: bt.grossPnl || 0,
        netPnl: bt.netPnl || 0,
        peakBalance: bt.peakBalance || bt.initialBalance || 10000,
        maxWin: bt.maxWin || 0,
        maxLoss: bt.maxLoss || 0,
        grossWinsTotal: bt.grossWinsTotal || 0,
        grossLossesTotal: bt.grossLossesTotal || 0,
        consecutiveWins: bt.consecutiveWins || 0,
        maxConsecutiveWins: bt.maxConsecutiveWins || 0,
        consecutiveLosses: bt.consecutiveLosses || 0,
        maxConsecutiveLosses: bt.maxConsecutiveLosses || 0,
        longTrades: bt.longTrades || 0,
        longWins: bt.longWins || 0,
        longLosses: bt.longLosses || 0,
        shortTrades: bt.shortTrades || 0,
        shortWins: bt.shortWins || 0,
        shortLosses: bt.shortLosses || 0,
        tradeHistory: bt.tradeHistory || [],
"""

# Replace Firebase Load
fb_load_match = re.search(r'bt\.balance = fbState\.balance;.*?bt\.losses = fbState\.losses;', code, re.DOTALL)
if fb_load_match:
    new_fb_load = fb_load_match.group(0) + load_fields.replace("obj", "fbState")
    code = code.replace(fb_load_match.group(0), new_fb_load)

# Replace LocalStorage Load
ls_load_match = re.search(r'bt\.balance = saved\.balance;.*?bt\.losses = saved\.losses;', code, re.DOTALL)
if ls_load_match:
    new_ls_load = ls_load_match.group(0) + load_fields.replace("obj", "saved")
    code = code.replace(ls_load_match.group(0), new_ls_load)

# Replace dataToSave (LocalStorage save)
data_save_match = re.search(r'balance: bt\.balance,\s*feesPaid: bt\.feesPaid \|\| 0,\s*maxDrawdown: bt\.maxDrawdown \|\| 0,\s*maxDrawdownPct: bt\.maxDrawdownPct \|\| 0,\s*trades: bt\.trades,\s*wins: bt\.wins,\s*losses: bt\.losses,', code, re.DOTALL)
if data_save_match:
    new_data_save = data_save_match.group(0) + save_fields
    code = code.replace(data_save_match.group(0), new_data_save)

# Replace Firebase save
fb_save_match = re.search(r'balance: bt\.balance,\s*feesPaid: bt\.feesPaid \|\| 0,\s*maxDrawdown: bt\.maxDrawdown \|\| 0,\s*maxDrawdownPct: bt\.maxDrawdownPct \|\| 0,\s*trades: bt\.trades,\s*wins: bt\.wins,\s*losses: bt\.losses,', code[data_save_match.end():], re.DOTALL)
if fb_save_match:
    new_fb_save = fb_save_match.group(0) + save_fields
    code = code[:data_save_match.end()] + code[data_save_match.end():].replace(fb_save_match.group(0), new_fb_save, 1)

with open("js/backtest.js", "w", encoding="utf-8") as f:
    f.write(code)

print("Patched successfully!")
