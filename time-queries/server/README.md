# Queries 

```
MATCH (r:Repo) 
WHERE r.lastUpdated <= $timestamp AND r.created >= $timestamp 
RETURN count(r) as value, 'activeRepos' as label
```

```
MATCH (r1:Repo)-[ref:REFERENCES_REPO]->(r2:Repo)
WHERE 
r2.id in ["rtfeldman/elm-css", "mdgriffith/style-elements"] AND 
(ref.start < $timestamp AND (ref.end > $timestamp OR (NOT EXISTS(ref.end))))
RETURN r2.id as label, count(distinct(r1.id)) as value
```