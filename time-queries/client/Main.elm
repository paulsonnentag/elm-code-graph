module Main exposing (..)

import Html exposing (..)
import Html.Attributes exposing (class, cols, rows, value, disabled)
import Html.Events exposing (onInput, onClick)
import LineChart
import LineChart.Dots as Dots
import Color
import Dict exposing (Dict)
import Http
import Json.Decode as Decode


main : Program Never Model Msg
main =
    Html.program
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }



--- MODEL


type alias Model =
    { loading : Bool
    , query : String
    , result : Maybe (Result Http.Error GraphData)
    }


type alias GraphData =
    Dict String (List Float)


init : ( Model, Cmd Msg )
init =
    ( { loading = False
      , query = "MATCH (r:Repo) WHERE r.lastUpdated <= $timestamp AND r.created >= $timestamp RETURN count(r) as value, 'activeRepos' as label"
      , result = Nothing
      }
    , Cmd.none
    )


decodeData : Decode.Decoder GraphData
decodeData =
    Decode.dict (Decode.list Decode.float)



-- UPDATE


type Msg
    = LoadResult (Result Http.Error GraphData)
    | UpdateQuery String
    | RunQuery


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        LoadResult result ->
            ( { model | loading = False, result = Just result }, Cmd.none )

        UpdateQuery query ->
            ( { model | query = query }, Cmd.none )

        RunQuery ->
            let
                url =
                    "http://localhost:3000?q=" ++ model.query

                request =
                    Http.get url decodeData
            in
                ( { model | loading = True, result = Nothing }, Http.send LoadResult request )



-- VIEW


view : Model -> Html Msg
view { loading, query, result } =
    div []
        [ textarea
            [ cols 100
            , rows 5
            , value query
            , onInput UpdateQuery
            , disabled loading
            ]
            []
        , br [] []
        , button
            [ onClick RunQuery
            , disabled loading
            ]
            [ text "run" ]
        , div []
            [ case result of
                Nothing ->
                    text ""

                Just result ->
                    case result of
                        Ok sequences ->
                            chart sequences

                        Err message ->
                            pre [] [ text ("Error!!" ++ (toString message)) ]
            ]
        ]


chart : GraphData -> Html.Html msg
chart graph =
    LineChart.view
        (\( key, value ) -> toFloat key)
        (\( key, value ) -> value)
        (graph
            |> Dict.map graphSequenceToLine
            |> Dict.values
        )


graphSequenceToLine : String -> List Float -> LineChart.Series ( Int, Float )
graphSequenceToLine label values =
    LineChart.line Color.red Dots.none label (List.indexedMap (,) values)



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none
