
/**
 * Formats a number as currency string.
 * Supports privacy mode to mask sensitive data.
 * 
 * @param value The number to format
 * @param privacyMode Whether to mask the value
 * @param fractionDigits Number of decimal places (default 2)
 * @returns Formatted string
 */
export const formatCurrency = (value: number | undefined | null, privacyMode: boolean, fractionDigits: number = 2): string => {
    if (value === undefined || value === null) return '-';
    
    if (privacyMode) {
        return '****';
    }

    return value.toLocaleString('zh-CN', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    });
};

/**
 * Short format for large numbers (e.g., 1.2w)
 */
export const formatCurrencyShort = (value: number, privacyMode: boolean): string => {
    if (privacyMode) return '****';
    if (!value) return '0';
    
    const absVal = Math.abs(value);
    if (absVal >= 100000000) {
        return (value / 100000000).toFixed(2) + '亿';
    }
    if (absVal >= 10000) {
        return (value / 10000).toFixed(2) + 'w';
    }
    return value.toLocaleString();
};
