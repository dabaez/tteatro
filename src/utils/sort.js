export function sort(obras) {
    return obras.sort((a, b) => {
        if (a.data.tickets && !b.data.tickets) return -1;
        if (!a.data.tickets && b.data.tickets) return 1;
        return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
    });
}