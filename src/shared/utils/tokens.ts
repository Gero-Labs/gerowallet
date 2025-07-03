import { Token } from "../models/tokens";

export const calculateTokenShortage = (token: Token): number => {
    if (token.quantity === undefined || Number(token.quantity) === 0) {
        return 0;
    }
    const realBalance = token.decimals > 0 ? token.balance / 10 ** token.decimals : token.balance || 0;
    const adaShortage = realBalance - token.quantity;
    return adaShortage > 0 ? 0 : adaShortage;
};