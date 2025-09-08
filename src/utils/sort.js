export function sort(obras) {
    return obras.sort((a, b) => {
        if (a.tickets && !b.tickets) return -1;
        if (!a.tickets && b.tickets) return 1;
        return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
    });
}