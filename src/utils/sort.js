export function sort(obras, ticketsData = {}) {
    return obras.sort((a, b) => {
        const aHasTicket = !!ticketsData[a.id];
        const bHasTicket = !!ticketsData[b.id];
        if (aHasTicket && !bHasTicket) return -1;
        if (!aHasTicket && bHasTicket) return 1;
        return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
    });
}