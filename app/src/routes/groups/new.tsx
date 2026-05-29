import { useMutation } from "@apollo/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { graphql } from "@/__generated__/index.js";

export const Route = createFileRoute("/groups/new")({
  component: NewGroupPage,
});

const CREATE_GROUP = graphql(`
  mutation CreateGroup($name: String!, $overlapThreshold: Int) {
    createGroup(name: $name, overlapThreshold: $overlapThreshold) {
      id
      name
    }
  }
`);

function NewGroupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [createGroup, { loading, error }] = useMutation(CREATE_GROUP);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await createGroup({
      variables: { name, overlapThreshold: threshold },
    });
    const id = res.data?.createGroup.id;
    if (id) navigate({ to: "/groups/$groupId", params: { groupId: id } });
  }

  return (
    <div className="p-8 max-w-md mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Create a Group</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Group name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekend hiking crew"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="threshold" className="text-sm font-medium">
            Overlap threshold: {threshold}%
          </label>
          <input
            id="threshold"
            type="range"
            min={0}
            max={100}
            step={5}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Minimum percentage of members who must share a free slot to start a normal vote.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create Group"}
        </button>
      </form>
    </div>
  );
}
