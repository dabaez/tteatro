export function sort(obras, ticketsData = {}) {
    return obras.sort((a, b) => {
        const aHasTicket = !!ticketsData[a.slug];
        const bHasTicket = !!ticketsData[b.slug];
        if (aHasTicket && !bHasTicket) return -1;
        if (!aHasTicket && bHasTicket) return 1;
        return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
    });
}